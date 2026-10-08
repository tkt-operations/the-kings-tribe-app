#!/usr/bin/env bash
# =============================================================================
# Guarded access to the TRAINING Supabase database — and nothing else.
# See docs/training/TRAINING-ENVIRONMENT.md.
#
# WHY THIS EXISTS: this repository's Supabase CLI link points at PRODUCTION.
# Any `supabase ... --linked` command would run against production. Training
# work must therefore never use --linked; this script only ever passes an
# explicit training connection string (--db-url) after verifying it.
#
# Usage:
#   scripts/training/training-db.sh check                 offline: verify the configuration only
#   scripts/training/training-db.sh status                read-only: list migrations on the training DB
#   scripts/training/training-db.sh verify                read-only: run the TRAINING church-name guard
#   scripts/training/training-db.sh migrate --dry-run     read-only: show migrations that would be applied
#   scripts/training/training-db.sh migrate               WRITE: apply migrations to the training DB
#   scripts/training/training-db.sh seed [all|<scenario>] WRITE: load the training seed
#   scripts/training/training-db.sh reset <all|<scenario>> DESTRUCTIVE: delete scenario data, then re-seed it
#
# Safeguards (all fail closed):
#   * values come only from .env.training.local (never .env.local), read as text, never executed
#   * NEXT_PUBLIC_APP_ENVIRONMENT must be "training"
#   * TRAINING_PROJECT_REF must look like a project ref and must not be production's
#   * the project ref inside TRAINING_DB_URL must equal TRAINING_PROJECT_REF; anything unverifiable is refused
#   * production's ref anywhere in the configuration is refused
#   * --linked / --project-ref / --local are refused
#   * writes require typing the training project ref at an interactive prompt
#   * passwords and connection strings are never printed (output is masked)
# =============================================================================
set -euo pipefail

PRODUCTION_PROJECT_REF="xxemwgdmibhneefnfiyr"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${TKT_TRAINING_ENV_FILE:-$REPO_ROOT/.env.training.local}"
TRAINING_SQL_DIR="$REPO_ROOT/supabase/training"

die() {
  echo "REFUSED: $*" >&2
  exit 2
}

usage() {
  sed -n '/^# Usage:/,/^#$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 64
}

# --- 1. Arguments ------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    *--linked* | *--project-ref* | *--local*)
      die "'$arg' is not allowed. Training commands only ever target the verified training database." ;;
  esac
done
[ "$#" -ge 1 ] || usage
COMMAND="$1"
shift

# --- 2. Configuration file ----------------------------------------------------
[ "$(basename "$ENV_FILE")" = ".env.training.local" ] || die "the configuration file must be named .env.training.local."
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Copy .env.training.example to .env.training.local and fill in TRAINING values only."

# Reads KEY=value as plain text (the file is never sourced or executed).
read_var() {
  local key="$1" line value=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key="*) value="${line#*=}" ;;
    esac
  done <"$ENV_FILE"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

APP_ENVIRONMENT="$(read_var NEXT_PUBLIC_APP_ENVIRONMENT)"
PROJECT_REF="$(read_var TRAINING_PROJECT_REF)"
DB_URL="$(read_var TRAINING_DB_URL)"
SUPABASE_URL="$(read_var NEXT_PUBLIC_SUPABASE_URL)"

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

[ "$APP_ENVIRONMENT" = "training" ] || die "NEXT_PUBLIC_APP_ENVIRONMENT must be 'training' in .env.training.local."
[ -n "$PROJECT_REF" ] || die "TRAINING_PROJECT_REF is missing."
[ -n "$DB_URL" ] || die "TRAINING_DB_URL is missing."
[[ "$PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || die "TRAINING_PROJECT_REF does not look like a Supabase project reference."
[ "$PROJECT_REF" != "$PRODUCTION_PROJECT_REF" ] || die "TRAINING_PROJECT_REF is the PRODUCTION project."
case "$(lower "$DB_URL")" in *"$PRODUCTION_PROJECT_REF"*) die "TRAINING_DB_URL points at the PRODUCTION project." ;; esac
case "$(lower "$SUPABASE_URL")" in *"$PRODUCTION_PROJECT_REF"*) die "NEXT_PUBLIC_SUPABASE_URL points at the PRODUCTION project." ;; esac

# --- 3. Verify the database target -------------------------------------------
# Accepts the two Supabase connection-string forms:
#   postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres                (direct)
#   postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres (pooler)
case "$DB_URL" in
  postgres://* | postgresql://*) ;;
  *) die "TRAINING_DB_URL is not a postgres:// connection string." ;;
esac
REST="${DB_URL#*://}"
AUTHORITY="${REST%%/*}"
case "$AUTHORITY" in *@*) ;; *) die "TRAINING_DB_URL has no user/host part; the target cannot be verified." ;; esac
USERINFO="${AUTHORITY%@*}"
HOSTPORT="${AUTHORITY##*@}"
HOST="$(lower "${HOSTPORT%%:*}")"
DB_USER="$(lower "${USERINFO%%:*}")"
DB_PASSWORD=""
case "$USERINFO" in *:*) DB_PASSWORD="${USERINFO#*:}" ;; esac

HOST_REF=""
USER_REF=""
if [[ "$HOST" =~ ^db\.([a-z0-9]{20})\.supabase\.co$ ]]; then HOST_REF="${BASH_REMATCH[1]}"; fi
if [[ "$DB_USER" =~ ^postgres\.([a-z0-9]{20})$ ]]; then USER_REF="${BASH_REMATCH[1]}"; fi
if [ -n "$USER_REF" ] && [[ ! "$HOST" =~ \.pooler\.supabase\.com$ ]]; then USER_REF=""; fi
[ -n "$HOST_REF" ] || [ -n "$USER_REF" ] || die "the project behind TRAINING_DB_URL cannot be verified (expected a Supabase direct or pooler connection string)."
if [ -n "$HOST_REF" ] && [ -n "$USER_REF" ] && [ "$HOST_REF" != "$USER_REF" ]; then die "TRAINING_DB_URL names two different projects."; fi
TARGET_REF="${HOST_REF:-$USER_REF}"
[ "$TARGET_REF" = "$PROJECT_REF" ] || die "TRAINING_DB_URL is for a different project than TRAINING_PROJECT_REF."
[ "$TARGET_REF" != "$PRODUCTION_PROJECT_REF" ] || die "TRAINING_DB_URL points at the PRODUCTION project."

if [ -n "$SUPABASE_URL" ]; then
  [[ "$(lower "$SUPABASE_URL")" =~ ^https://([a-z0-9]{20})\.supabase\.co/?$ ]] || die "NEXT_PUBLIC_SUPABASE_URL is not a Supabase project URL; the target cannot be verified."
  [ "${BASH_REMATCH[1]}" = "$PROJECT_REF" ] || die "NEXT_PUBLIC_SUPABASE_URL is for a different project than TRAINING_PROJECT_REF."
fi

# --- 4. Helpers ---------------------------------------------------------------
# Runs a command with the connection string and password masked in all output.
run_masked() {
  local status
  set +e
  "$@" 2>&1 | TKT_MASK_URL="$DB_URL" TKT_MASK_PW="$DB_PASSWORD" perl -pe '
    BEGIN { $u = $ENV{TKT_MASK_URL}; $p = $ENV{TKT_MASK_PW}; ($d = $p) =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge; }
    s/\Q$u\E/[TRAINING_DB_URL]/g;
    s/\Q$p\E/[REDACTED]/g if length $p;
    s/\Q$d\E/[REDACTED]/g if length $d;
  '
  status="${PIPESTATUS[0]}"
  set -e
  return "$status"
}

supabase_cli() {
  # Always an explicit --db-url; never --linked.
  run_masked npx --no-install supabase "$@" --db-url "$DB_URL"
}

confirm_write() {
  local what="$1" typed=""
  [ -t 0 ] || die "$what needs interactive confirmation (no terminal attached)."
  echo "About to $what on the TRAINING project $PROJECT_REF."
  read -r -p "Type the training project ref to continue: " typed
  [ "$typed" = "$PROJECT_REF" ] || die "confirmation did not match; nothing was changed."
}

validate_scenario() {
  [[ "$1" =~ ^(all|[a-z0-9_]{1,60})$ ]] || die "invalid scenario name '$1'."
}

# `supabase db query` sends a file to Postgres as ONE prepared statement, which
# cannot hold several commands. Each training SQL file is therefore wrapped,
# unchanged and unsplit, as the body of a single statement:
#     do $tkt_run_<random>$ begin execute $tkt_sql_<random>$ <file> $tkt_sql_<random>$; end $tkt_run_<random>$;
# PL/pgSQL EXECUTE runs a multi-command string in the same session (so the
# seed's pg_temp helpers stay available) and the whole file is atomic: any
# error rolls all of it back. The random tags are checked not to occur in the file.
wrap_sql_file() {
  local src="$1" dest="$2" scenario="${3:-}" tag
  tag="$(od -An -N8 -tx1 /dev/urandom | tr -d " \n")"
  [ "${#tag}" -eq 16 ] || die "could not generate a quoting tag."
  if grep -q "tkt_run_$tag\|tkt_sql_$tag" "$src"; then die "quoting tag collision; try again."; fi
  {
    printf 'do $tkt_run_%s$ begin execute $tkt_sql_%s$\n' "$tag" "$tag"
    if [ -n "$scenario" ]; then sed "s/__TRAINING_SCENARIO__/$scenario/g" "$src"; else cat "$src"; fi
    printf '\n$tkt_sql_%s$; end $tkt_run_%s$;\n' "$tag" "$tag"
  } >"$dest"
}

# Runs a training SQL file (scenario filled in) as one statement.
run_sql_file() {
  local file="$1" scenario="${2:-}" tmp status=0
  tmp="$(mktemp "${TMPDIR:-/tmp}/tkt-training.XXXXXX")"
  wrap_sql_file "$TRAINING_SQL_DIR/$file" "$tmp" "$scenario"
  supabase_cli db query -f "$tmp" || status=$?
  rm -f "$tmp"
  return "$status"
}

run_training_sql() {
  local status=0
  run_sql_file "$1" "$2" || status=$?
  [ "$status" -eq 0 ] || die "$1 failed (exit $status). Nothing from this file was applied; check the output above."
}

verify_guard() {
  echo "Checking the TRAINING church-name guard..."
  run_sql_file guard.sql || die "the training guard failed; nothing was changed."
}

# --- 5. Commands --------------------------------------------------------------
case "$COMMAND" in
  check)
    [ "$#" -eq 0 ] || usage
    echo "Training target verified: project $PROJECT_REF (configuration only; no database contacted)."
    ;;
  status)
    [ "$#" -eq 0 ] || usage
    supabase_cli migration list
    ;;
  verify)
    [ "$#" -eq 0 ] || usage
    verify_guard
    ;;
  migrate)
    if [ "${1:-}" = "--dry-run" ] && [ "$#" -eq 1 ]; then
      supabase_cli db push --dry-run
    else
      [ "$#" -eq 0 ] || usage
      confirm_write "apply database migrations"
      supabase_cli db push
    fi
    ;;
  seed)
    SCENARIO="${1:-all}"
    [ "$#" -le 1 ] || usage
    validate_scenario "$SCENARIO"
    confirm_write "load training seed '$SCENARIO'"
    verify_guard
    run_training_sql seed_training.sql "$SCENARIO"
    ;;
  reset)
    [ "$#" -eq 1 ] || usage
    SCENARIO="$1"
    validate_scenario "$SCENARIO"
    confirm_write "DELETE and re-create training data for '$SCENARIO'"
    verify_guard
    run_training_sql reset_scenarios.sql "$SCENARIO"
    run_training_sql seed_training.sql "$SCENARIO"
    ;;
  *)
    usage
    ;;
esac
