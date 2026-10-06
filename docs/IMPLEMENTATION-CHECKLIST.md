# Implementation Checklist

Derived from `docs/SPEC.md`. Section numbers refer to the spec.
Legend: `[x]` done and verified locally · `[~]` done, needs external account to verify end-to-end · `[ ]` not started.

## Phase 1 — Foundation (§1, §2, §4, §5, §30, §31, §32)
- [ ] Next.js (App Router) + TypeScript + Tailwind scaffold
- [ ] Brand tokens: colors (§2 palette), DM Serif Display + Satoshi, official logo files copied unmodified
- [ ] Supabase clients: browser (publishable key), server (cookie session), admin (service role, server-only)
- [ ] `proxy.ts` session refresh + internal route protection
- [ ] Migrations: core tables, roles, permissions, user_roles, profiles, church_settings
- [ ] `has_permission()` + RLS on every table; anon has no table access
- [ ] Audit log table, immutable, trigger-based + semantic audit entries
- [ ] Safe document numbering (TKT-REQ-YYYY-NNNN / TKT-PO-YYYY-NNNN)
- [ ] Login, password reset, invite acceptance, sign-out, safe redirects
- [ ] Application shell: desktop sidebar, mobile bottom nav, permission-filtered
- [ ] First-administrator bootstrap (`/setup`, protected by SETUP_TOKEN)

## Phase 2 — Sunday Reporting (§6, §7, §8, §9)
- [ ] Configurable categories (attendance / finance / requisition) with subcategories, rename, deactivate, reorder
- [ ] Cost centers (Accounting/Budget)
- [ ] Sunday Entry: date picker, attendance bucket, finance bucket, live totals, server-side totals
- [ ] Negative amounts only for categories flagged `allows_negative`
- [ ] Finance edit/void with audit trail
- [ ] Dashboard: latest Sunday KPIs, previous Sunday, 4-week trend, MTD, YTD, date filter
- [ ] Charts: attendance trend, adult vs children, weekly giving, giving by category, MTD giving, requisition spending, requisition status

## Phase 3 — Requisitions (§10–§20, §49)
- [ ] Departments + subcategories (seeded, configurable)
- [ ] Request types table with workflow kind + per-type rules (seed 5 types, Order default)
- [ ] External form links: random token, hashed at rest, expiry/revoke, optional department lock
- [ ] Public form `/request/[token]`: church info, policy, requester, department → subcategory, request type, financial coding, budget status, line items (+ Add Item), justification, certification
- [ ] Reimbursement-specific fields + receipt upload (signed upload URLs, private bucket)
- [ ] Anti-spam: honeypot, minimum fill time, DB rate limit
- [ ] Server-side validation (Zod + DB function), server-side totals (numeric)
- [ ] Requisition number generation, status Submitted, audit, finance + requester emails
- [ ] Requisitions list: search, filters, columns per §18
- [ ] Requisition detail: timeline, all sections per §49, permission/status-aware actions
- [ ] Review: approve / partial / hold / reject, per-line decisions, required comments
- [ ] Controlled transitions + status history

## Phase 4 — Purchasing (§21, §22, §23, §27)
- [ ] Issue PO from approved lines (quantities ≤ approved), PO number
- [ ] PDF Purchase Order (react-pdf) with official logo, stored privately, download via signed URL
- [ ] PO email to requester with PDF attachment + receipt instructions + reply address
- [ ] Record vendor orders (multiple, partial), quantities tracked
- [ ] Disbursements for Reimbursement / Petty Cash / Advance Check
- [ ] Branded email templates for all §27 events; notification log

## Phase 5 — Receipts (§24, §25, §26)
- [ ] Internal upload (direct to private Storage, validated by bucket + DB function)
- [ ] Inbound email webhook (Resend `email.received`), Svix signature verification, idempotency
- [ ] Matching: plus-address reply token → PO/requisition number in subject → sender check; unmatched queue
- [ ] Reconciliation screen: ordered / approved / purchased / actual / remaining / variance per line
- [ ] Partial purchases, multiple receipts, price differences, cancel remaining quantity
- [ ] Derived statuses: PO Issued → Ordered → Partially Purchased → Purchased; Close

## Phase 6 — Reporting & PWA (§29, §33–§36, §40)
- [ ] Reports: attendance, finance, requisitions/purchasing with date ranges
- [ ] CSV exports
- [ ] Manifest, icons (unaltered logomark on brand canvas), apple-touch-icon, safe areas, standalone
- [ ] Settings: church info, currency, timezone, notification email, policy, PO footer
- [ ] Request types, cost centers, form links, users & roles, role-permission matrix, audit log viewer
- [ ] Setup wizard
- [ ] SMS provider abstraction (Twilio) with opt-in/out; disabled until configured

## Phase 7 — Security / Testing / Deployment (§32, §37, §38, §41–§48, §51)
- [ ] Security headers (CSP etc.), secrets server-only, `.env.example`
- [ ] Unit tests: money, totals, validation, transitions, tokens, webhook signatures, email matching
- [ ] DB tests (PGlite, real migrations): RLS, anon lockout, submission, review, PO, orders, reconciliation, statuses
- [ ] Demo data (flagged `is_demo`) + removal script
- [ ] Lint, typecheck, tests, production build all green
- [ ] README.md, SETUP-GUIDE.md (beginner, click-by-click), manual-actions list
- [ ] Acceptance checklist (§51) walk-through
