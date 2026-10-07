# The Kings Tribe — Finance & Operations

A private, installable web application (PWA) for The Kings Tribe church team:

- **Sunday Entry**: attendance and finance received, with automatic totals.
- **Executive dashboard**: latest Sunday, comparisons, trends and charts.
- **Requisitions**: department leads submit through a secure link. They have no account and see nothing internal.
- **Finance review**: approve, partially approve, hold or reject, line by line.
- **Purchasing**:
  - Branded PDF Purchase Orders.
  - Vendor orders.
  - Receipts by upload or email reply.
  - Reconciliation, disbursements and closing.
- **Reports and CSV exports**.
- **Administration**:
  - Users and roles.
  - Permissions.
  - Categories, departments, request types and requisition links.
  - Audit log and settings.

> **New here?** Follow **[SETUP-GUIDE.md](SETUP-GUIDE.md)**. It is written for non-developers and lists every click.
> The full requirements are in [docs/SPEC.md](docs/SPEC.md). Progress is tracked in [docs/IMPLEMENTATION-CHECKLIST.md](docs/IMPLEMENTATION-CHECKLIST.md).

---

## Technology

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, Server Actions, `proxy.ts`), React 19, TypeScript |
| Styling | Tailwind CSS 4 with brand design tokens (`app/globals.css`) |
| Data | Supabase: PostgreSQL, Auth, private Storage, Row Level Security |
| Forms | React Hook Form + Zod; the same schema runs in the browser and on the server |
| Charts | Recharts |
| PDF | `@react-pdf/renderer`, using the brand fonts and the official logo |
| Email | Resend: transactional sending, plus inbound receipts via webhook |
| SMS | Twilio, behind a provider abstraction (off until configured) |
| Hosting | Vercel |
| Tests | Vitest. Database tests run the **real migrations** in PGlite (in-process PostgreSQL), so no Docker is needed |

## Project layout

```
app/
  (auth)/           login, password reset
  (app)/            internal app (requires an active staff account)
    dashboard/  sunday/  requisitions/[id]/  purchase-orders/  receipts/
    reports/  categories/  departments/  admin/{settings,users,roles,form-links,request-types,audit,setup}
  request/[token]/  PUBLIC requisition form (secure link, no account)
  notifications/[token]/  requester email/SMS preferences
  api/inbound-email/      Resend webhook (signature-verified)
  setup/                  first-administrator bootstrap (SETUP_TOKEN)
components/         UI kit, brand logo component, app shell, charts
lib/                money (exact BigInt cents), dates, auth, notify, email, sms, pdf, inbound, validation
supabase/
  migrations/       schema, workflow functions, RLS, storage, reference data
  demo/             load_demo_data.sql / remove_demo_data.sql
tests/
  unit/             money, dates, validation, PDF, emails, webhooks, matching, CSV, reports
  db/               RLS, grants, workflow engine, Sunday entry, demo data (PGlite)
public/brand/       OFFICIAL logo files, copied unmodified from brand-assets/
assets/fonts/       DM Serif Display (OFL) and Satoshi (ITF FFL), original files
```

## Commands

```bash
npm install          # install dependencies
npm run dev          # http://localhost:3000
npm run lint         # ESLint
npm run typecheck    # Next route types + TypeScript
npm test             # all unit + database tests
npm run build        # production build
npm run check        # lint + typecheck + test + build
npm run icons        # regenerate PWA icons from the official logomark
npx supabase db push # apply migrations to the linked Supabase project
```

## How it works

### Security model
- **Database first.** Every table has Row Level Security. Permissions such as `finance.view` and `requisitions.review` are checked in PostgreSQL by `private.has_permission()`, not only in the UI.
- **Financial writes go through database functions** (`review_requisition`, `issue_purchase_order`, `reconcile_receipt`, and so on). Each function checks permission, validates its input, writes everything in one transaction, and records an audit entry. Users cannot update financial tables directly.
- **External requisition form.**
  - The anonymous role has **no table access**. It can call exactly one function, `get_request_form_context(token)`.
  - Submissions go through a trusted server action, which validates input, applies anti-spam checks and rate limits, then calls `submit_requisition`.
  - Link tokens are 256-bit random values. Only their SHA-256 hash is stored, and links can expire, be limited, or be revoked.
- **Server secrets** (`SUPABASE_SECRET_KEY`, `RESEND_*`, `TWILIO_*`, `SETUP_TOKEN`) are read only in `server-only` modules. A build with sentinel values confirmed none of them reach browser bundles.
- **Storage is private.**
  - Files are served through 60-second signed URLs after a permission check.
  - Buckets enforce MIME type and a 10 MB limit, and policies restrict upload paths.
- **Webhooks** must carry a valid Svix signature. Each email is processed once (unique provider id).
- **Audit log** is append-only, enforced by a trigger. Not even administrators can edit or delete entries.
- **Other protections:**
  - CSP and security headers.
  - Same-origin checks on server actions.
  - Safe redirects.
  - Escaped email templates.
  - CSV formula-injection protection.
  - Parameterized queries throughout.
  - Only administrators can grant the Administrator role or change role permissions.

### Money
- Stored as PostgreSQL `numeric(14,2)`. Quantities are `numeric(12,2)`.
- Totals are **recalculated in the database**. Values the browser sends are ignored.
- The browser uses exact integer-cent BigInt maths for live previews, with the same half-away-from-zero rounding as PostgreSQL. No floating point is used for any stored value.

### Requisition workflow
`Submitted → Under Review → (On Hold) → Approved / Partially Approved / Rejected → PO Issued → Ordered → Partially Purchased → Purchased → Closed`

- Purchasing statuses are **derived** from actual activity:
  - Purchase Orders issued.
  - Vendor orders placed.
  - Receipt quantities that Finance has **reconciled**.
- A receipt arriving never marks anything as purchased.
- Allowed transitions are enforced in `private.transition_allowed()`.

Request types are rows in a table, not code. Each type uses one of five workflows (Order, Direct Purchase, Reimbursement, Petty Cash, Advance Check) and carries its own rules: required receipt, purchase details, cost center, spending limit, PO, vendor orders, disbursement.

### Inbound receipts
1. Purchase Order and status emails use a reply-to address such as `receipts+po-<token>@<inbound domain>`.
2. When the requester replies with photos or PDFs, Resend calls `/api/inbound-email`.
3. The app verifies the signature, then matches the email. It tries the reply token first. A PO or requisition number in the subject is accepted only when the **sender is the requester**.
4. Attachments are stored privately and a **pending** receipt is queued for Finance to reconcile.
5. Emails that can't be matched appear under **Receipts → Unmatched** for manual assignment.

### In-app notifications
- Internal users have an operational inbox: the **bell** in the app shell and the **/notifications** page. It is separate from the email log (`notifications` table), which keeps recording emails sent.
- Inbox rows (`user_notifications`) are created **only by database triggers** on workflow tables, in the same transaction as the change. Recipients come from the permission tables, never from role names. External requesters keep receiving email only.
- Each user reads only their own rows, and only while they still hold the permission a row requires. Read state changes through `mark_notification_read` / `mark_all_notifications_read`.
- The dashboard's **Needs attention** cards are live workflow state (`my_needs_attention()`), not notification history.
- Optional **phone notifications** (Web Push) alert users to important and actionable items. They are best effort, use generic lock-screen text, and need the VAPID variables (off when unset).
- See [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) for the event catalog, routing, actor rules and push setup.

## Branding

| Element | What the app uses |
|---|---|
| Colors | Deep Navy `#12172D`, Royal Gold `#F3C94A`, white, black, Ministry Blue, Energy Orange, Kingdom Green, Neutral Gray. Accents (Highlight Yellow, Fresh Lime) appear only sparingly. |
| Typography | DM Serif Display for headings, Satoshi for everything else |
| Logos | Official SVG/PNG files rendered with `<img>` at their native aspect ratio. Never redrawn, recolored, cropped or stretched. |
| App icons | The unaltered gold logomark, scaled proportionally on a solid navy canvas (an approved pairing) |
| PDF logo | Official primary navy logo PNG |

**Brand-file inconsistencies noticed during the review** (please confirm with your designer):

- **Accent hex codes.** Page 16 of the guidelines labels the accents `#3166DD` / `#FD5820`. The app uses the color-palette PDF's `#FFFD38` / `#99E555`.
- **Folder naming.** The "Secondary Logo" folder also contains the Landscape lockup.

**Font licensing.**
- **Satoshi (ITF Free Font License):** self-hosting and PDF embedding are allowed, but the font files may not be redistributed publicly. **Keep this repository private.**
- **DM Serif Display:** SIL Open Font License.

## Demo data
`supabase/demo/load_demo_data.sql` loads fictional data, all flagged `is_demo` and labelled "DEMO":

- 12 Sundays of attendance and finance.
- One requisition in every status.

It runs the real workflow functions, so its history and audit trail are genuine. `supabase/demo/remove_demo_data.sql` deletes it all and never touches real data. Audit entries about the demo remain because the audit log is append-only. See SETUP-GUIDE §5.6.

## Testing
`npm test` runs about 125 tests. Database tests apply every migration to an in-process PostgreSQL with stand-ins for Supabase's `auth` and `storage` schemas. They exercise:

- RLS and anonymous lockout.
- The privilege-escalation guards.
- Submission validation and request-type rules.
- Numbering.
- Approve, partial, hold and reject.
- Purchase Orders, partial and multiple vendor orders.
- Receipts and partial reconciliation.
- Cancelling remaining quantities, disbursements and closing.
- Inbound-email idempotency.
- Sunday totals.
- Demo load and removal.

Not covered automatically (they need live accounts):

- Real Supabase Auth flows (invite, password reset).
- Real Resend sending and receiving.
- Twilio.

The acceptance checklist in SETUP-GUIDE §13 covers these.
