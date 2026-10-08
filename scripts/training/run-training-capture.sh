#!/usr/bin/env bash
# =============================================================================
# Runs the TRAINING app locally the way it runs live — a production build and
# `next start`, never the dev server — for screenshots and video.
# See docs/training/TRAINING-ENVIRONMENT.md.
#
# Usage (from the repository root):
#   scripts/training/run-training-capture.sh           verify, build, then serve at NEXT_PUBLIC_APP_URL
#   scripts/training/run-training-capture.sh --check   verify only
#
# Every safeguard of run-training.sh applies (it does the work): values only
# from .env.training.local, training mode required, production project
# refused, Supabase URL must match TRAINING_PROJECT_REF, local address only,
# email/phone-alert/SMS variables refused and blanked, nothing printed.
# =============================================================================
set -euo pipefail
for arg in "$@"; do
  case "$arg" in
    --check) ;;
    *) echo "REFUSED: unknown argument '$arg'. Usage: scripts/training/run-training-capture.sh [--check]" >&2; exit 2 ;;
  esac
done
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-training.sh" --capture "$@"
