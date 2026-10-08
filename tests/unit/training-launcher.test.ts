/**
 * scripts/training/run-training.sh starts `next dev` only with a verified
 * training configuration. Runs offline: a fake `npx` on PATH records the
 * arguments and environment it was launched with instead of starting a server.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts", "training", "run-training.sh");
const PROD = "xxemwgdmibhneefnfiyr";
const TRAIN = "abcdefghijklmnopqrst";
const SECRET = "sb_secret_TRAINING_ONLY_value";
const PUBLISHABLE = "sb_publishable_TRAINING_ONLY_value";
const SETUP = "setup-token-TRAINING-ONLY";
const DB_PASSWORD = "db-password-TRAINING-ONLY";
const jwt = (claims: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

let dir: string;
let appDir: string;
let npxLog: string;

const good = (over: Record<string, string | undefined> = {}) => ({
  NEXT_PUBLIC_APP_ENVIRONMENT: "training",
  NEXT_PUBLIC_SUPABASE_URL: `https://${TRAIN}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  SUPABASE_SECRET_KEY: SECRET,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  SETUP_TOKEN: SETUP,
  TRAINING_PROJECT_REF: TRAIN,
  TRAINING_DB_URL: `postgresql://postgres:${DB_PASSWORD}@db.${TRAIN}.supabase.co:5432/postgres`,
  ...over,
});

function envFile(values: Record<string, string | undefined>, name = ".env.training.local") {
  const lines = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
  writeFileSync(path.join(dir, name), lines.join("\n") + "\n");
  return path.join(dir, name);
}

function run(args: string[], file = path.join(dir, ".env.training.local"), extraEnv: Record<string, string> = {}) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: `${dir}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, TKT_TRAINING_ENV_FILE: file, TKT_TRAINING_APP_DIR: appDir, ...extraEnv } as unknown as NodeJS.ProcessEnv,
    input: "",
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

/** The environment and arguments the fake `npx` was started with, or null if it never ran. */
function launched() {
  if (!existsSync(npxLog)) return null;
  const [args, ...envLines] = readFileSync(npxLog, "utf8").split("\0");
  const env = Object.fromEntries(envLines.filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { args, cwd: env.__CWD, env };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tkt-launcher-test-"));
  appDir = path.join(dir, "app");
  mkdirSync(appDir);
  npxLog = path.join(dir, "npx-launch");
  writeFileSync(path.join(dir, "npx"), `#!/bin/bash\n{ printf '%s\\0' "$*"; printf '__CWD=%s\\0' "$PWD"; env -0; } > "${npxLog}"\nexit 0\n`);
  chmodSync(path.join(dir, "npx"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function expectNoSecrets(out: string) {
  for (const value of [SECRET, PUBLISHABLE, SETUP, DB_PASSWORD, "sb_secret", "sb_publishable", "postgresql://", "eyJ"]) expect(out).not.toContain(value);
}

describe("run-training.sh refuses", () => {
  it("when .env.training.local is missing", () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/REFUSED: \.env\.training\.local not found/);
    expect(launched()).toBeNull();
  });

  it("a configuration file with any other name (e.g. the production .env.local)", () => {
    const r = run([], envFile(good(), ".env.local"));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/must be named \.env\.training\.local/);
    expect(launched()).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["production", "production"],
    ["capitalised", "Training"],
  ])("when training mode is %s", (_label, mode) => {
    const r = run([], envFile(good({ NEXT_PUBLIC_APP_ENVIRONMENT: mode })));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/NEXT_PUBLIC_APP_ENVIRONMENT must be 'training'/);
    expect(launched()).toBeNull();
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_APP_URL", "SETUP_TOKEN", "TRAINING_PROJECT_REF"])(
    "when %s is missing",
    (key) => {
      const r = run([], envFile(good({ [key]: undefined })));
      expect(r.code).toBe(2);
      expect(r.out).toContain(`${key} is missing`);
      expect(launched()).toBeNull();
    },
  );

  it.each([
    ["the production Supabase URL", { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }],
    ["the production project ref", { TRAINING_PROJECT_REF: PROD, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }],
    ["the production ref in upper case", { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD.toUpperCase()}.supabase.co` }],
    ["the production ref in any other value", { TRAINING_DB_URL: `postgresql://postgres:x@db.${PROD}.supabase.co:5432/postgres` }],
  ])("%s", (_label, over) => {
    const r = run([], envFile(good(over)));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/PRODUCTION/);
    expect(launched()).toBeNull();
  });

  it.each([
    ["a Supabase URL for another project", { NEXT_PUBLIC_SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" }, /different project than TRAINING_PROJECT_REF/],
    ["a project ref that does not match the URL", { TRAINING_PROJECT_REF: "zzzzzzzzzzzzzzzzzzzz" }, /different project than TRAINING_PROJECT_REF/],
    ["a non-Supabase URL", { NEXT_PUBLIC_SUPABASE_URL: `https://${TRAIN}.example.com` }, /cannot be verified/],
    ["a malformed project ref", { TRAINING_PROJECT_REF: "not-a-ref" }, /does not look like/],
    ["a legacy key for another project", { SUPABASE_SECRET_KEY: jwt({ ref: "zzzzzzzzzzzzzzzzzzzz", role: "service_role" }) }, /SUPABASE_SECRET_KEY belongs to a different project/],
    ["a service-role key used as the publishable key", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt({ ref: TRAIN, role: "service_role" }) }, /must never reach the browser/],
    ["an unreadable legacy key", { SUPABASE_SECRET_KEY: "eyJnot-a-token" }, /SUPABASE_SECRET_KEY cannot be verified/],
    ["a non-local app address", { NEXT_PUBLIC_APP_URL: "https://ops.thekingstribe.org" }, /must be a local address/],
    ["email turned on", { RESEND_API_KEY: "re_should_not_be_here" }, /RESEND_API_KEY must not be set in training/],
    ["SMS turned on", { TWILIO_AUTH_TOKEN: "twilio_should_not_be_here" }, /TWILIO_AUTH_TOKEN must not be set/],
    ["phone alerts turned on", { VAPID_PRIVATE_KEY: "vapid_should_not_be_here" }, /VAPID_PRIVATE_KEY must not be set/],
  ])("%s", (_label, over, message) => {
    const r = run([], envFile(good(over)));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(message);
    expectNoSecrets(r.out);
    expect(r.out).not.toContain("should_not_be_here");
    expect(launched()).toBeNull();
  });

  it("unknown arguments", () => {
    const r = run(["--port=4000"], envFile(good()));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/unknown argument/);
    expect(launched()).toBeNull();
  });
});

describe("run-training.sh with a valid training configuration", () => {
  it("--check verifies without starting the server", () => {
    const r = run(["--check"], envFile(good()));
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Training configuration verified: project ${TRAIN}`);
    expectNoSecrets(r.out);
    expect(launched()).toBeNull();
  });

  it("starts the normal Next.js dev server in the app directory with only the training values", () => {
    const r = run([], envFile(good()));
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("Starting TKT Training locally at http://localhost:3000");
    const l = launched()!;
    expect(l.args).toBe("--no-install next dev --port 3000");
    expect(l.cwd).toBe(realpathSync(appDir));
    expect(l.env).toMatchObject({
      NEXT_PUBLIC_APP_ENVIRONMENT: "training",
      NEXT_PUBLIC_SUPABASE_URL: `https://${TRAIN}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      SUPABASE_SECRET_KEY: SECRET,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      SETUP_TOKEN: SETUP,
      __NEXT_PROCESSED_ENV: "true",
    });
    // The database connection string never reaches the app.
    expect(l.env.TRAINING_DB_URL).toBe("");
    expect(JSON.stringify(l.env)).not.toContain(DB_PASSWORD);
  });

  it("accepts a quoted file, a custom local port and legacy keys for the training project", () => {
    const anon = jwt({ ref: TRAIN, role: "anon" });
    const file = envFile(good({ NEXT_PUBLIC_APP_URL: '"http://localhost:3100"', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon, SUPABASE_SECRET_KEY: jwt({ ref: TRAIN, role: "service_role" }) }));
    const r = run([], file);
    expect(r.code).toBe(0);
    expectNoSecrets(r.out);
    expect(launched()!.args).toBe("--no-install next dev --port 3100");
    expect(launched()!.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(anon);
  });

  it("never lets production values in from the shell or from .env files, and blanks email, SMS and phone alerts", () => {
    // A production-style .env.local next to the app (scratch directory only).
    writeFileSync(path.join(appDir, ".env.local"), [
      `NEXT_PUBLIC_SUPABASE_URL=https://${PROD}.supabase.co`,
      "SUPABASE_SECRET_KEY=sb_secret_PRODUCTION",
      "RESEND_API_KEY=re_PRODUCTION",
      "SOME_FUTURE_PRODUCTION_SETTING=prod-value",
    ].join("\n"));
    writeFileSync(path.join(appDir, ".env"), "export ANOTHER_PRODUCTION_SETTING=prod-value\n");
    const r = run([], envFile(good()), { RESEND_API_KEY: "re_PRODUCTION_SHELL", SUPABASE_SERVICE_ROLE_KEY: "PRODUCTION_SHELL", UNRELATED_SHELL_VAR: "x" });
    expect(r.code).toBe(0);
    const { env } = launched()!;
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(`https://${TRAIN}.supabase.co`);
    expect(env.SUPABASE_SECRET_KEY).toBe(SECRET);
    for (const key of [
      "RESEND_API_KEY", "EMAIL_FROM", "RECEIPTS_INBOUND_ADDRESS", "RESEND_WEBHOOK_SECRET", "RESEND_DELIVERY_WEBHOOK_SECRET",
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
      "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
      "SOME_FUTURE_PRODUCTION_SETTING", "ANOTHER_PRODUCTION_SETTING",
    ]) expect([key, env[key]]).toEqual([key, ""]); // present but blank: Next.js will not fill it from a file
    expect(env.UNRELATED_SHELL_VAR).toBeUndefined();
    expect(JSON.stringify(Object.values(env))).not.toMatch(/PRODUCTION|prod-value|xxemwg/);
  });

  it("prints nothing secret, even when the server starts", () => {
    const r = run([], envFile(good()));
    expectNoSecrets(r.out);
    expect(r.out).not.toContain(TRAIN + ".supabase.co");
  });
});

describe("run-training-capture.sh (production build + next start, never the dev server)", () => {
  const CAPTURE = path.join(process.cwd(), "scripts", "training", "run-training-capture.sh");
  let callLog: string;
  function fakeNpx(buildFails = false) {
    callLog = path.join(dir, "npx-calls");
    writeFileSync(path.join(dir, "npx"), `#!/bin/bash
printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$*" "$NODE_ENV" "$NEXT_PUBLIC_APP_ENVIRONMENT" "$__NEXT_PROCESSED_ENV" "\${RESEND_API_KEY-unset}" >> "${callLog}"
case "$*" in *"next build"*) exit ${buildFails ? 1 : 0} ;; esac
exit 0
`);
    chmodSync(path.join(dir, "npx"), 0o755);
  }
  function runCapture(args: string[], file = path.join(dir, ".env.training.local"), extraEnv: Record<string, string> = {}) {
    const result = spawnSync("bash", [CAPTURE, ...args], {
      encoding: "utf8",
      env: { PATH: `${dir}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, TKT_TRAINING_ENV_FILE: file, TKT_TRAINING_APP_DIR: appDir, ...extraEnv } as unknown as NodeJS.ProcessEnv,
      input: "",
    });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  }
  const calls = () => (existsSync(callLog) ? readFileSync(callLog, "utf8").replace(/\n$/, "").split("\n").map((l) => l.split("\t")) : []);

  it("builds in production mode with the training values, then starts next start — never next dev", () => {
    fakeNpx();
    const r = runCapture([], envFile(good()), { RESEND_API_KEY: "re_PRODUCTION_SHELL" });
    expect(r.code).toBe(0);
    expect(calls()).toEqual([
      ["--no-install next build", "production", "training", "true", ""],
      ["--no-install next start --port 3000", "production", "training", "true", ""],
    ]);
    expect(r.out).toContain("Building TKT Training in production mode (training values only)...");
    expect(r.out).toContain("Starting TKT Training (capture mode) locally at http://localhost:3000");
    expect(r.out).not.toMatch(/next dev/);
    expectNoSecrets(r.out);
  });

  it("does not start the server when the build fails", () => {
    fakeNpx(true);
    const r = runCapture([], envFile(good()));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/training production build failed; the server was not started/);
    expect(calls().map((c) => c[0])).toEqual(["--no-install next build"]);
  });

  it.each([
    ["a missing training file", undefined, /\.env\.training\.local not found/],
    ["the production project", { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }, /PRODUCTION/],
    ["a mismatched project ref", { TRAINING_PROJECT_REF: "zzzzzzzzzzzzzzzzzzzz" }, /different project than TRAINING_PROJECT_REF/],
    ["training mode off", { NEXT_PUBLIC_APP_ENVIRONMENT: "production" }, /must be 'training'/],
    ["a non-local address", { NEXT_PUBLIC_APP_URL: "https://ops.thekingstribe.org" }, /must be a local address/],
  ])("refuses %s before building anything", (_label, over, message) => {
    fakeNpx();
    const r = runCapture([], over === undefined ? undefined : envFile(good(over)));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(message);
    expect(calls()).toHaveLength(0);
  });

  it("--check verifies without building; other arguments are refused", () => {
    fakeNpx();
    expect(runCapture(["--check"], envFile(good())).code).toBe(0);
    expect(runCapture(["--dev"], envFile(good())).code).toBe(2);
    expect(calls()).toHaveLength(0);
  });
});
