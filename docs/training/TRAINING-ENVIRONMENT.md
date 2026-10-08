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

### For screenshots and video: capture mode
```
scripts/training/run-training-capture.sh
```
Same checks and clean environment as above, but it runs a **production build** (`next build`) and then `next start` — never the dev server — so no development tools (such as the Next.js "N" button) appear on screen. The training banner and the "TKT Training" name are part of the build. It prints `Building TKT Training in production mode (training values only)...`, then `Starting TKT Training (capture mode) locally at http://localhost:3000`. Stop the dev server first (both use port 3000). `--check` verifies without building. The build goes into `.next`, which is never committed or deployed (Vercel builds production itself).

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

## Dates in the seeded history
Every seeded requisition has one consistent timeline: submission and certification on a weekday morning the chosen number of days ago, then review, Purchase Order, order, receipt, purchase and close each a plausible number of hours later, in order, and never later than the present. The status history, POs, vendor orders, receipts and in-app notifications all follow it, and needed-by is two weeks after submission (so older requests have past needed-by dates). The one exception is the **Audit log**: it is append-only by design, so its entries keep the real time the seed ran. Avoid presenting audit-log times as historical in screenshots and video.

## Reset strategy
- **Before each take:** `reset <scenario>`.
- **Before a recording day:** `reset all` (keeps users, settings and the audit log).
- **If the database gets into a bad state:** recreate the training project.

See `supabase/training/README.md`.

## Support contact
[SUPPORT CONTACT TO BE CONFIRMED]
