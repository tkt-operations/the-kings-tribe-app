#!/usr/bin/env bash
# =============================================================================
# Runs the app locally against the TRAINING Supabase project — and nothing else.
# See docs/training/TRAINING-ENVIRONMENT.md.
#
# Usage (from the repository root):
#   scripts/training/run-training.sh             verify .env.training.local, then start `next dev`
#   scripts/training/run-training.sh --check     verify only; do not start the server
#   scripts/training/run-training.sh --capture   production build + `next start` (no dev tools on screen),
#                                                 normally run as scripts/training/run-training-capture.sh
#
# Why a launcher: Next.js never reads .env.training.local by itself, and it
# fills any variable missing from the process environment from .env.local,
# .env.development(.local) and .env. This script therefore starts Next.js
# with a clean environment containing only the verified training values, and
# with every other application variable explicitly blank, so no production
# value can be picked up from an .env file — including on a hot reload.
#
# Safeguards (all fail closed):
#   * values come only from .env.training.local, read as text, never executed
#   * NEXT_PUBLIC_APP_ENVIRONMENT must be "training"; the app's own guard then
#     also refuses the production database at startup
#   * every required variable must be present
#   * production's project ref anywhere in the file is refused
#   * NEXT_PUBLIC_SUPABASE_URL must be https://<TRAINING_PROJECT_REF>.supabase.co
#   * legacy JWT keys must belong to the training project
#   * NEXT_PUBLIC_APP_URL must be a local http://localhost address
#   * email, delivery-webhook, phone-alert and SMS variables are refused in the
#     file and passed to Next.js as blank
#   * TRAINING_DB_URL is never passed to the app
#   * no value is ever printed
# =============================================================================
set -euo pipefail

PRODUCTION_PROJECT_REF="xxemwgdmibhneefnfiyr"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${TKT_TRAINING_ENV_FILE:-$REPO_ROOT/.env.training.local}"
# The directory Next.js runs in (overridable only so the tests can use a scratch directory).
APP_DIR="${TKT_TRAINING_APP_DIR:-$REPO_ROOT}"

# The only variables the training app receives from .env.training.local.
PASSED_KEYS="NEXT_PUBLIC_APP_ENVIRONMENT NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY NEXT_PUBLIC_APP_URL SETUP_TOKEN"
# Must not be set in training; always passed to Next.js as blank.
FORBIDDEN_KEYS="RESEND_API_KEY EMAIL_FROM RECEIPTS_INBOUND_ADDRESS RESEND_WEBHOOK_SECRET RESEND_DELIVERY_WEBHOOK_SECRET NEXT_PUBLIC_VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER TWILIO_MESSAGING_SERVICE_SID"
# Legacy fallbacks the app also reads; always passed as blank.
BLANKED_KEYS="NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY TRAINING_DB_URL TRAINING_PROJECT_REF"

die() {
  echo "REFUSED: $*" >&2
  exit 2
}

CHECK_ONLY=0
CAPTURE=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --capture) CAPTURE=1 ;;
    *) die "unknown argument '$arg'. Usage: scripts/training/run-training.sh [--check] [--capture]" ;;
  esac
done

# --- 1. Configuration file ----------------------------------------------------
[ "$(basename "$ENV_FILE")" = ".env.training.local" ] || die "the configuration file must be named .env.training.local."
[ -f "$ENV_FILE" ] || die ".env.training.local not found. Copy .env.training.example to .env.training.local and fill in TRAINING values only."

# Reads KEY=value as plain text (the file is never sourced or executed).
read_var() {
  local key="$1" file="${2:-$ENV_FILE}" line value=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key="* | "export $key="*) value="${line#*=}" ;;
    esac
  done <"$file"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

# Variable names (never values) defined in a dotenv file.
key_names() {
  sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\2/p' "$1"
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# --- 2. Required values ---------------------------------------------------------
APP_ENVIRONMENT="$(read_var NEXT_PUBLIC_APP_ENVIRONMENT)"
PROJECT_REF="$(read_var TRAINING_PROJECT_REF)"
SUPABASE_URL="$(read_var NEXT_PUBLIC_SUPABASE_URL)"
APP_URL="$(read_var NEXT_PUBLIC_APP_URL)"

[ "$APP_ENVIRONMENT" = "training" ] || die "NEXT_PUBLIC_APP_ENVIRONMENT must be 'training' in .env.training.local."
for key in $PASSED_KEYS TRAINING_PROJECT_REF; do
  [ -n "$(read_var "$key")" ] || die "$key is missing from .env.training.local."
done

# --- 3. Never production ------------------------------------------------------
grep -qi "$PRODUCTION_PROJECT_REF" "$ENV_FILE" && die ".env.training.local refers to the PRODUCTION Supabase project."
[[ "$PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || die "TRAINING_PROJECT_REF does not look like a Supabase project reference."
[ "$PROJECT_REF" != "$PRODUCTION_PROJECT_REF" ] || die "TRAINING_PROJECT_REF is the PRODUCTION project."

[[ "$(lower "$SUPABASE_URL")" =~ ^https://([a-z0-9]{20})\.supabase\.co/?$ ]] || die "NEXT_PUBLIC_SUPABASE_URL is not a Supabase project URL; the target cannot be verified."
URL_REF="${BASH_REMATCH[1]}"
[ "$URL_REF" != "$PRODUCTION_PROJECT_REF" ] || die "NEXT_PUBLIC_SUPABASE_URL points at the PRODUCTION project."
[ "$URL_REF" = "$PROJECT_REF" ] || die "NEXT_PUBLIC_SUPABASE_URL is for a different project than TRAINING_PROJECT_REF."

# Legacy JWT keys name their project; new sb_ keys do not (they only work with their own project).
check_jwt_key() {
  local key="$1" value claims
  value="$(read_var "$key")"
  case "$value" in eyJ*) ;; *) return 0 ;; esac
  claims="$(TKT_JWT="$value" node -e '
    try {
      const p = JSON.parse(Buffer.from(process.env.TKT_JWT.split(".")[1], "base64url").toString("utf8"));
      process.stdout.write(`${p.ref ?? ""} ${p.role ?? ""}`);
    } catch { process.exit(1); }' 2>/dev/null)" || die "$key cannot be verified."
  [ "${claims%% *}" = "$PROJECT_REF" ] || die "$key belongs to a different project than TRAINING_PROJECT_REF."
  if [ "$key" = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" ] && [ "${claims#* }" = "service_role" ]; then
    die "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is a secret service-role key; it must never reach the browser."
  fi
}
check_jwt_key NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
check_jwt_key SUPABASE_SECRET_KEY

[[ "$APP_URL" =~ ^http://(localhost|127\.0\.0\.1)(:([0-9]{2,5}))?$ ]] || die "NEXT_PUBLIC_APP_URL must be a local address such as http://localhost:3000 for the local launcher."
PORT="${BASH_REMATCH[3]:-3000}"

for key in $FORBIDDEN_KEYS; do
  [ -z "$(read_var "$key")" ] || die "$key must not be set in training (email, webhooks, phone alerts and SMS stay off)."
done

if [ "$CHECK_ONLY" = 1 ]; then
  echo "Training configuration verified: project $PROJECT_REF, local address $APP_URL. Server not started (--check)."
  exit 0
fi

# --- 4. Build a clean environment ------------------------------------------------
# Every application variable not passed above is set to blank: Next.js never
# fills a variable that is already in the environment, even a blank one, so
# nothing from .env.local / .env.development(.local) / .env can leak in.
BLANK=""
for key in $FORBIDDEN_KEYS $BLANKED_KEYS; do BLANK="$BLANK $key"; done
for file in .env.development.local .env.local .env.development .env; do
  [ -f "$APP_DIR/$file" ] || continue
  for key in $(key_names "$APP_DIR/$file"); do
    case " $PASSED_KEYS " in *" $key "*) ;; *) BLANK="$BLANK $key" ;; esac
  done
done

# Read every value before clearing the environment.
VALUES=()
for key in $PASSED_KEYS; do VALUES+=("$(read_var "$key")"); done

# Clear the inherited environment (exported variables only, so no value ever
# appears in a process listing), keeping only what a shell and npx need.
for var in $(compgen -e); do
  case " PATH HOME USER LOGNAME SHELL TERM TMPDIR LANG " in *" $var "*) ;; *) unset "$var" 2>/dev/null || true ;; esac
done
for key in $BLANK; do export "$key="; done
i=0
for key in $PASSED_KEYS; do export "$key=${VALUES[$i]}"; i=$((i + 1)); done
# Tells Next.js the environment is already loaded, so it skips the .env files entirely.
export __NEXT_PROCESSED_ENV=true
cd "$APP_DIR"

if [ "$CAPTURE" = 1 ]; then
  # Capture mode: the same production build and server the live app uses, so
  # no development tools appear on screen. NEXT_PUBLIC_* values (training
  # mode, the training Supabase project) are fixed into this build.
  export NODE_ENV=production
  echo "Building TKT Training in production mode (training values only)..."
  npx --no-install next build || { echo "REFUSED: the training production build failed; the server was not started." >&2; exit 1; }
  echo "Starting TKT Training (capture mode) locally at $APP_URL"
  exec npx --no-install next start --port "$PORT"
fi

export NODE_ENV=development
echo "Starting TKT Training locally at $APP_URL"
exec npx --no-install next dev --port "$PORT"
