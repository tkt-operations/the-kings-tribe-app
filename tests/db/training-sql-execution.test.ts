/**
 * How scripts/training/training-db.sh executes the training SQL files.
 *
 * `supabase db query -f` sends a file as ONE prepared statement, which cannot
 * hold several commands ("cannot insert multiple commands into a prepared
 * statement"). The wrapper therefore wraps each file, unsplit, in a single
 * DO ... EXECUTE statement. These tests run the wrapper end to end with a fake
 * `npx` that captures the exact SQL it would send, then execute that SQL in
 * PGlite with `db.query` — the same one-prepared-statement protocol — so no
 * remote database is ever contacted.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, createUser, expectError, one, type Db } from "./harness";

const SCRIPT = path.join(process.cwd(), "scripts", "training", "training-db.sh");
const SQL_DIR = path.join(process.cwd(), "supabase", "training");
const PROD = "xxemwgdmibhneefnfiyr";
const TRAIN = "abcdefghijklmnopqrst";
const PASSWORD = "pw-TRAINING-ONLY";
const DB_URL = `postgresql://postgres:${PASSWORD}@db.${TRAIN}.supabase.co:5432/postgres`;

// Answers the wrapper's typed-confirmation prompt from inside a real pseudo-terminal.
const PTY_HELPER = `import os, pty, sys
answer, cmd = sys.argv[1], sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
buf, sent = b"", False
while True:
    try:
        data = os.read(fd, 1024)
    except OSError:
        break
    if not data:
        break
    buf += data
    if not sent and b"Type the training project ref" in buf:
        os.write(fd, answer.encode() + b"\\n"); sent = True
sys.stdout.write(buf.decode(errors="replace"))
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;

let dir: string;
let captureDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tkt-training-sql-"));
  captureDir = path.join(dir, "captured");
  // Fake npx: saves the SQL file it was given (in call order) and the arguments, contacts nothing.
  writeFileSync(path.join(dir, "npx"), `#!/bin/bash
mkdir -p "${captureDir}"
n=$(ls "${captureDir}" | grep -c '\\.sql$')
printf '%s\\n' "$*" > "${captureDir}/$n.args"
while [ $# -gt 0 ]; do if [ "$1" = "-f" ]; then cp "$2" "${captureDir}/$n.sql"; fi; shift; done
exit 0
`);
  chmodSync(path.join(dir, "npx"), 0o755);
  writeFileSync(path.join(dir, "pty_run.py"), PTY_HELPER);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function envFile(over: Record<string, string> = {}) {
  const values = { NEXT_PUBLIC_APP_ENVIRONMENT: "training", NEXT_PUBLIC_SUPABASE_URL: `https://${TRAIN}.supabase.co`, TRAINING_PROJECT_REF: TRAIN, TRAINING_DB_URL: DB_URL, ...over };
  writeFileSync(path.join(dir, ".env.training.local"), Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}

/** Runs the wrapper in a pseudo-terminal, typing `answer` at the confirmation prompt. */
function runWithTerminal(args: string[], answer = TRAIN) {
  const r = spawnSync("python3", [path.join(dir, "pty_run.py"), answer, "bash", SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, TMPDIR: dir, TKT_TRAINING_ENV_FILE: path.join(dir, ".env.training.local") } as unknown as NodeJS.ProcessEnv,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const captured = () => {
  const files = (() => { try { return readdirSync(captureDir); } catch { return []; } })();
  return files.filter((f) => f.endsWith(".sql")).sort((a, b) => parseInt(a) - parseInt(b)).map((f) => ({
    sql: readFileSync(path.join(captureDir, f), "utf8"),
    args: readFileSync(path.join(captureDir, f.replace(".sql", ".args")), "utf8").trim(),
  }));
};

async function trainingDatabase() {
  const db = await createTestDatabase();
  await db.query("update public.church_settings set church_name = 'The Kings Tribe (TRAINING)' where id = 1");
  await createUser(db, "morgan.ellis@training.invalid", ["administrator"], "Morgan Ellis");
  await createUser(db, "taylor.brooks@training.invalid", ["head_of_finance"], "Taylor Brooks");
  await createUser(db, "riley.chen@training.invalid", ["finance_user"], "Riley Chen");
  await createUser(db, "sam.patel@training.invalid", ["reporting_user"], "Sam Patel");
  return db;
}
const count = async (db: Db, sql: string) => Number((await one<{ n: string }>(db, `select count(*) as n from (${sql}) q`)).n);

describe("the root cause", () => {
  it("the raw multi-statement seed cannot be sent as one prepared statement", async () => {
    const db = await trainingDatabase();
    const raw = readFileSync(path.join(SQL_DIR, "seed_training.sql"), "utf8").replaceAll("__TRAINING_SCENARIO__", "all");
    await expectError(db.query(raw), /cannot insert multiple commands into a prepared statement/);
  });
});

describe("training-db.sh seed and reset", () => {
  it("seed sends the guard, then the whole seed file as single statements that run as one prepared statement each", async () => {
    envFile();
    const r = runWithTerminal(["seed"]);
    expect(r.code).toBe(0);
    const calls = captured();
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.args).toMatch(/^--no-install supabase db query -f \S+ --db-url \S+$/);
      expect(c.args).not.toContain("--linked");
      expect(c.sql).toMatch(/^do \$tkt_run_([0-9a-f]{16})\$ begin execute \$tkt_sql_\1\$\n[\s\S]*\n\$tkt_sql_\1\$; end \$tkt_run_\1\$;\n$/);
    }
    // The original files are carried through whole, with only the scenario filled in.
    expect(calls[0].sql).toContain(readFileSync(path.join(SQL_DIR, "guard.sql"), "utf8"));
    expect(calls[1].sql).toContain(readFileSync(path.join(SQL_DIR, "seed_training.sql"), "utf8").replaceAll("__TRAINING_SCENARIO__", "all"));
    expect(calls[1].sql).not.toContain("__TRAINING_SCENARIO__");

    const db = await trainingDatabase();
    for (const c of calls) await db.query(c.sql);
    expect(await count(db, "select 1 from public.requisitions")).toBe(20);
    expect(await count(db, "select 1 from public.service_dates")).toBe(27);

    expect(r.out).not.toContain(PASSWORD);
    expect(r.out).not.toContain("postgresql://");
  });

  it("reset sends guard, reset and seed through the same single-statement path", async () => {
    envFile();
    expect(runWithTerminal(["seed", "review_take_2"]).code).toBe(0);
    const r = runWithTerminal(["reset", "review_take_2"]);
    expect(r.code).toBe(0);
    const calls = captured();
    expect(calls).toHaveLength(5); // seed: guard, seed · reset: guard, reset, seed
    expect(calls[3].sql).toContain(readFileSync(path.join(SQL_DIR, "reset_scenarios.sql"), "utf8").replaceAll("__TRAINING_SCENARIO__", "review_take_2"));

    const db = await trainingDatabase();
    for (const c of calls.slice(0, 2)) await db.query(c.sql);
    const first = await one<{ id: string }>(db, "select id from public.requisitions where submission_fingerprint = 'training:review_take_2'");
    for (const c of calls.slice(2)) await db.query(c.sql);
    const second = await one<{ id: string }>(db, "select id from public.requisitions where submission_fingerprint = 'training:review_take_2'");
    expect(second.id).not.toBe(first.id);
    expect(await count(db, "select 1 from public.requisitions")).toBe(1);
  });

  it("a wrapped file is atomic: the TRAINING guard failing applies nothing", async () => {
    envFile();
    expect(runWithTerminal(["seed"]).code).toBe(0);
    const db = await trainingDatabase();
    await db.query("update public.church_settings set church_name = 'The Kings Tribe' where id = 1");
    for (const c of captured()) await expectError(db.query(c.sql), /TRAINING GUARD: refusing/);
    expect(await count(db, "select 1 from public.requisitions")).toBe(0);
    expect(await count(db, "select 1 from public.external_form_tokens")).toBe(0);
  });

  it("uses a fresh quoting tag on every run", () => {
    envFile();
    runWithTerminal(["seed"]);
    runWithTerminal(["seed"]);
    const tags = captured().map((c) => c.sql.match(/^do \$tkt_run_([0-9a-f]{16})\$/)?.[1]);
    expect(new Set(tags).size).toBe(4);
  });
});

describe("safeguards still hold with a terminal attached", () => {
  it("a wrong typed confirmation sends nothing", () => {
    envFile();
    const r = runWithTerminal(["seed"], "wrongwrongwrongwrong");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/confirmation did not match; nothing was changed/);
    expect(captured()).toHaveLength(0);
  });

  it("typing the production ref is refused, and a production configuration never reaches the prompt", () => {
    envFile();
    expect(runWithTerminal(["seed"], PROD).code).toBe(2);
    envFile({ TRAINING_PROJECT_REF: PROD, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`, TRAINING_DB_URL: `postgresql://postgres:${PASSWORD}@db.${PROD}.supabase.co:5432/postgres` });
    const r = runWithTerminal(["seed"], PROD);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/PRODUCTION project/);
    expect(r.out).not.toContain("Type the training project ref");
    expect(captured()).toHaveLength(0);
  });

  it.each([["seed", "--linked"], ["reset", "all", "--project-ref=x"]])("%s with a link flag is refused", (...args) => {
    envFile();
    const r = runWithTerminal(args);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/is not allowed/);
    expect(captured()).toHaveLength(0);
  });
});
