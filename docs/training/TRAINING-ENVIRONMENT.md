# Training environment

A fully separate copy of the app for screenshots, videos and practice. It uses fictional data only.

## Architecture
- **Separate Supabase project** (Free plan), with its own database, auth, storage and keys. Nothing is shared with production.
- **Separate Vercel project** (planned name `tkt-operations-training`), on its `*.vercel.app` address. Production branch `training`, pinned to an approved commit. Deployment Protection off; the app's own sign-in protects internal pages.
- **Same code**, with training mode switched on by `NEXT_PUBLIC_APP_ENVIRONMENT=training`.

## What training mode does (only when the variable is exactly `training`)
- Gold "TRAINING ENVIRONMENT · fictional data" banner on every page, including login and the request form. It reserves its own space and respects the iPhone safe area.
- Installed app named **TKT Training**; page titles start with "Training ·". Logos and icons are unchanged.
- **Refuses the production Supabase project** (`lib/training.ts`): server startup (`instrumentation.ts`), every Supabase client and `proxy.ts` (HTTP 503) all refuse.

When the variable is absent or anything else, production rendering and behavior are unchanged (tested).

## Production isolation
1. Separate project, keys and address.
2. The app refuses the production project in training mode.
3. `scripts/training/training-db.sh` refuses the production ref, `--linked`, `--project-ref` and `--local`, and any database it can't verify. Writes need the training ref typed at a prompt. It never prints passwords or connection strings.
4. Every training SQL file aborts unless the church name contains "TRAINING".
5. `scripts/training/run-training.sh` starts the local app with only the verified training values (see below).

## ⚠️ Supabase CLI danger
This repository's Supabase CLI is **linked to PRODUCTION**. **Never use `--linked` for training work.** Use only the wrapper:
```
scripts/training/training-db.sh check | status | verify | migrate [--dry-run] | seed [scenario] | reset <scenario|all>
```

## Running the training app locally
From the repository root:
```
scripts/training/run-training.sh
```
It starts the normal `next dev` server and prints only `Starting TKT Training locally at http://localhost:3000`. Stop it with Ctrl-C. To verify the configuration without starting anything, run `scripts/training/run-training.sh --check`.

Next.js never reads `.env.training.local` by itself, and it fills any missing variable from `.env.local`, `.env.development(.local)` or `.env`. The launcher therefore:
- reads `.env.training.local` as text (never executes it) and requires `NEXT_PUBLIC_APP_ENVIRONMENT=training`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`, `SETUP_TOKEN` and `TRAINING_PROJECT_REF`;
- refuses the production project ref anywhere in the file, a Supabase URL whose project isn't `TRAINING_PROJECT_REF`, legacy keys for another project, and a non-local `NEXT_PUBLIC_APP_URL`;
- refuses email, delivery-webhook, phone-alert and SMS variables in the file;
- starts Next.js with a cleared environment: the six app values above, and every other application variable (including any name found in a local `.env` file) set to blank, so nothing from production can be picked up. It also tells Next.js not to read `.env` files. `TRAINING_DB_URL` never reaches the app;
- never prints a value.

Don't rename `.env.training.local` to `.env.local`.

## Environment variables
Template: `.env.training.example`. Local values go in `.env.training.local` (git-ignored). Values come only from the TRAINING project and are never pasted into chat.

**Must never be copied from production:** Supabase URL and keys, `SETUP_TOKEN`, `RESEND_API_KEY`, `EMAIL_FROM`, `RECEIPTS_INBOUND_ADDRESS`, `RESEND_WEBHOOK_SECRET`, `RESEND_DELIVERY_WEBHOOK_SECRET`, all VAPID variables, all `TWILIO_*` variables, production `NEXT_PUBLIC_APP_URL`.

## Communication channels (all off)
- **Email:** no Resend key, so app emails are logged as "skipped". Fictional addresses use `.invalid` domains.
- **Supabase Auth emails:** invite with **copy link** only, never submit "Reset password", and add no custom SMTP.
- **Phone alerts:** off. A training-only key pair may be added later, only with approval.
- **SMS and inbound email:** off and not verified, so not part of training.

## Training identities (fictional)
| Name | Role |
|---|---|
| Morgan Ellis | Administrator |
| Taylor Brooks | Head of Finance |
| Riley Chen | Finance User |
| Sam Patel | Reporting User |
| Casey Rivera | Viewer |
| Jamie Carter | External requester |

Passwords are kept in a password manager, never in the repo.

## Reset strategy
- **Before each take:** `reset <scenario>`.
- **Before a recording day:** `reset all` (keeps users, settings and the audit log).
- **If the database gets into a bad state:** recreate the training project.

See `supabase/training/README.md`.

## Support contact
[SUPPORT CONTACT TO BE CONFIRMED]
