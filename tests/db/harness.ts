/**
 * In-process PostgreSQL (PGlite) harness that applies the REAL migrations from
 * supabase/migrations on top of minimal stand-ins for the Supabase-managed
 * `auth` and `storage` schemas. Lets us test RLS, grants and every workflow
 * function without Docker or a cloud project.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to postgres;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
create function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(name), '.', 1))
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;
grant execute on function storage.foldername(text), storage.extension(text) to anon, authenticated, service_role;
`;

export type Db = PGlite;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

async function apply(db: Db, files: string[]) {
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
}

/**
 * Fresh database with the migrations applied. Pass `before` (a migration
 * filename) to stop just before it — e.g. to load data in the previous schema
 * and then test a later migration's backfill with `applyMigrationsFrom`.
 */
export async function createTestDatabase(options: { before?: string } = {}): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const files = migrationFiles();
  await apply(db, options.before ? files.filter((f) => f < options.before!) : files);
  return db;
}

/** Apply the remaining migrations, starting with `first`. */
export async function applyMigrationsFrom(db: Db, first: string): Promise<void> {
  await apply(db, migrationFiles().filter((f) => f >= first));
}

type Role = "anon" | "authenticated" | "service_role";

/** Run `fn` as a given Postgres role (and optionally as a given auth user). */
export async function as<T>(db: Db, role: Role, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`select set_config('app.actor_label', '', false)`);
  }
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<T>(sql, params);
  if (result.rows.length !== 1) throw new Error(`Expected 1 row, got ${result.rows.length}: ${sql}`);
  return result.rows[0];
}

/** Create an auth user + profile and grant roles (as superuser, like the admin API would). */
export async function createUser(db: Db, email: string, roleKeys: string[], fullName = email): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, fullName],
  );
  for (const key of roleKeys) {
    await db.query(
      `insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = $2`,
      [id, key],
    );
  }
  return id;
}

export async function expectError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const message = (error as Error).message;
    if (!pattern.test(message)) {
      throw new Error(`Expected error matching ${pattern}, got: ${message}`);
    }
    return;
  }
  throw new Error(`Expected error matching ${pattern}, but the call succeeded`);
}
