/**
 * scripts/training/training-db.sh refuses anything it cannot prove is the
 * training project. Runs offline: a fake `npx` on PATH records any attempt to
 * reach a database, and no test here may trigger it.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts", "training", "training-db.sh");
const PROD = "xxemwgdmibhneefnfiyr";
const TRAIN = "abcdefghijklmnopqrst";
const PASSWORD = "s3cret%40pass";
const DIRECT = `postgresql://postgres:${PASSWORD}@db.${TRAIN}.supabase.co:5432/postgres`;
const POOLER = `postgresql://postgres.${TRAIN}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

let dir: string;
let npxMarker: string;

function envFile(values: Record<string, string | undefined>, name = ".env.training.local") {
  const lines = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
  writeFileSync(path.join(dir, name), lines.join("\n") + "\n");
  return path.join(dir, name);
}
const good = (over: Record<string, string | undefined> = {}) => ({
  NEXT_PUBLIC_APP_ENVIRONMENT: "training",
  NEXT_PUBLIC_SUPABASE_URL: `https://${TRAIN}.supabase.co`,
  SUPABASE_SECRET_KEY: "sb_secret_test_only",
  TRAINING_PROJECT_REF: TRAIN,
  TRAINING_DB_URL: DIRECT,
  ...over,
});

function run(args: string[], file?: string) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, TKT_TRAINING_ENV_FILE: file ?? path.join(dir, ".env.training.local") } as unknown as NodeJS.ProcessEnv,
    input: "", // never a terminal
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tkt-training-test-"));
  npxMarker = path.join(dir, "npx-was-called");
  writeFileSync(path.join(dir, "npx"), `#!/bin/sh\necho called > "${npxMarker}"\nexit 99\n`);
  chmodSync(path.join(dir, "npx"), 0o755);
});
afterEach(() => {
  expect(existsSync(npxMarker)).toBe(false); // no database was ever contacted
  rmSync(dir, { recursive: true, force: true });
});

describe("training-db.sh", () => {
  it.each([["direct", DIRECT], ["pooler", POOLER]])("accepts a verified %s training connection (offline check) without printing secrets", (_kind, url) => {
    const r = run(["check"], envFile(good({ TRAINING_DB_URL: url })));
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Training target verified: project ${TRAIN}`);
    expect(r.out).not.toContain(PASSWORD);
    expect(r.out).not.toContain("s3cret");
    expect(r.out).not.toContain("postgresql://");
    expect(r.out).not.toContain("sb_secret");
  });

  it.each([["--linked"], ["--project-ref=x"], ["--local"]])("refuses %s before reading anything", (flag) => {
    const r = run(["status", flag], envFile(good()));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/REFUSED: .* is not allowed/);
  });

  it("refuses when .env.training.local is missing", () => {
    const r = run(["check"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/REFUSED: .*\.env\.training\.local not found/);
  });

  it("refuses a configuration file with any other name (e.g. the production .env.local)", () => {
    const r = run(["check"], envFile(good(), ".env.local"));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/must be named \.env\.training\.local/);
  });

  it.each([
    ["TRAINING_PROJECT_REF", /TRAINING_PROJECT_REF is missing/],
    ["TRAINING_DB_URL", /TRAINING_DB_URL is missing/],
    ["NEXT_PUBLIC_APP_ENVIRONMENT", /must be 'training'/],
  ])("refuses when %s is missing", (key, message) => {
    const r = run(["check"], envFile(good({ [key]: undefined })));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(message);
  });

  it.each([
    ["the production project ref", { TRAINING_PROJECT_REF: PROD, TRAINING_DB_URL: `postgresql://postgres:${PASSWORD}@db.${PROD}.supabase.co:5432/postgres` }, /PRODUCTION project/],
    ["a production connection string", { TRAINING_DB_URL: `postgresql://postgres:${PASSWORD}@db.${PROD}.supabase.co:5432/postgres` }, /TRAINING_DB_URL points at the PRODUCTION project/],
    ["a production pooler user", { TRAINING_DB_URL: `postgresql://postgres.${PROD}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres` }, /PRODUCTION project/],
    ["a production Supabase URL", { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }, /NEXT_PUBLIC_SUPABASE_URL points at the PRODUCTION project/],
    ["a connection string for another project", { TRAINING_DB_URL: `postgresql://postgres:${PASSWORD}@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres` }, /different project/],
    ["an unverifiable host", { TRAINING_DB_URL: `postgresql://postgres:${PASSWORD}@localhost:5432/postgres` }, /cannot be verified/],
    ["a pooler-style user on a non-Supabase host", { TRAINING_DB_URL: `postgresql://postgres.${TRAIN}:${PASSWORD}@example.com:6543/postgres` }, /cannot be verified/],
    ["a Supabase URL for another project", { NEXT_PUBLIC_SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" }, /different project/],
    ["a malformed project ref", { TRAINING_PROJECT_REF: "not-a-ref" }, /does not look like/],
    ["a non-postgres URL", { TRAINING_DB_URL: "https://example.com" }, /not a postgres/],
  ])("refuses %s", (_label, over, message) => {
    const r = run(["check"], envFile(good(over)));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(message);
    expect(r.out).not.toContain(PASSWORD);
  });

  it.each([["migrate"], ["seed"], ["seed", "review_take_1"], ["reset", "all"]])("write command %s needs typed confirmation and refuses without a terminal", (...args) => {
    const r = run(args, envFile(good()));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/needs interactive confirmation/);
  });

  it("rejects scenario names that could inject SQL", () => {
    const r = run(["reset", "all'; drop table x; --"], envFile(good()));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/invalid scenario name/);
  });

  it("never uses --linked anywhere in the script", async () => {
    const { readFileSync } = await import("node:fs");
    const code = readFileSync(SCRIPT, "utf8").split("\n").filter((l) => !l.trim().startsWith("#"));
    expect(code.filter((l) => /supabase_cli|npx/.test(l)).some((l) => l.includes("--linked"))).toBe(false);
    expect(code.join("\n")).toContain('--db-url "$DB_URL"');
  });
});
