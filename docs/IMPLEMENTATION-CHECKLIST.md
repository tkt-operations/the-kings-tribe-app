# Implementation Checklist

Derived from `docs/SPEC.md`. Section numbers refer to the spec.
Legend: `[x]` done and verified locally · `[~]` done, needs external account to verify end-to-end · `[ ]` not started.

## Phase 1 — Foundation (§1, §2, §4, §5, §30, §31, §32)
- [x] Next.js (App Router) + TypeScript + Tailwind scaffold
- [x] Brand tokens: colors (§2 palette), DM Serif Display + Satoshi, official logo files copied unmodified
- [x] Supabase clients: browser (publishable key), server (cookie session), admin (service role, server-only)
- [x] `proxy.ts` session refresh + internal route protection
- [x] Migrations: core tables, roles, permissions, user_roles, profiles, church_settings
- [x] `has_permission()` + RLS on every table; anon has no table access
- [x] Audit log table, immutable, trigger-based + semantic audit entries
- [x] Safe document numbering (TKT-REQ-YYYY-NNNN / TKT-PO-YYYY-NNNN)
- [~] Login, password reset, invite acceptance, sign-out, safe redirects — needs a live Supabase project to verify end-to-end
- [x] Application shell: desktop sidebar, mobile bottom nav, permission-filtered
- [x] First-administrator bootstrap (`/setup`, protected by SETUP_TOKEN)

## Phase 2 — Sunday Reporting (§6, §7, §8, §9)
- [x] Configurable categories (attendance / finance / requisition) with subcategories, rename, deactivate, reorder
- [x] Cost centers (Accounting/Budget)
- [x] Sunday Entry: date picker, attendance bucket, finance bucket, live totals, server-side totals
- [x] Negative amounts only for categories flagged `allows_negative`
- [x] Finance edit/void with audit trail
- [x] Dashboard: latest Sunday KPIs, previous Sunday, 4-week trend, MTD, YTD, date filter
- [x] Charts: attendance trend, adult vs children, weekly giving, giving by category, MTD giving, requisition spending, requisition status

## Phase 3 — Requisitions (§10–§20, §49)
- [x] Departments + subcategories (seeded, configurable)
- [x] Request types table with workflow kind + per-type rules (seed 5 types, Order default)
- [x] External form links: random token, hashed at rest, expiry/revoke, optional department lock
- [x] Public form `/request/[token]`: church info, policy, requester, department → subcategory, request type, financial coding, budget status, line items (+ Add Item), justification, certification
- [x] Reimbursement-specific fields + receipt upload (signed upload URLs, private bucket)
- [x] Anti-spam: honeypot, minimum fill time, DB rate limit
- [x] Server-side validation (Zod + DB function), server-side totals (numeric)
- [x] Requisition number generation, status Submitted, audit, finance + requester emails
- [x] Requisitions list: search, filters, columns per §18
- [x] Requisition detail: timeline, all sections per §49, permission/status-aware actions
- [x] Review: approve / partial / hold / reject, per-line decisions, required comments
- [x] Controlled transitions + status history

## Phase 4 — Purchasing (§21, §22, §23, §27)
- [x] Issue PO from approved lines (quantities ≤ approved), PO number
- [x] PDF Purchase Order (react-pdf) with official logo, stored privately, download via signed URL
- [~] PO email to requester with PDF attachment + receipt instructions + reply address — needs Resend to verify live
- [x] Record vendor orders (multiple, partial), quantities tracked
- [x] Disbursements for Reimbursement / Petty Cash / Advance Check
- [x] Branded email templates for all §27 events; notification log

## Phase 5 — Receipts (§24, §25, §26)
- [x] Internal upload (direct to private Storage, validated by bucket + DB function)
- [~] Inbound email webhook (Resend `email.received`), Svix signature verification, idempotency — verified by tests; live check needs Resend
- [x] Matching: plus-address reply token → PO/requisition number in subject → sender check; unmatched queue
- [x] Reconciliation screen: ordered / approved / purchased / actual / remaining / variance per line
- [x] Partial purchases, multiple receipts, price differences, cancel remaining quantity
- [x] Derived statuses: PO Issued → Ordered → Partially Purchased → Purchased; Close

## Phase 6 — Reporting & PWA (§29, §33–§36, §40)
- [x] Reports: attendance, finance, requisitions/purchasing with date ranges
- [x] CSV exports
- [x] Manifest, icons (unaltered logomark on brand canvas), apple-touch-icon, safe areas, standalone
- [x] Settings: church info, currency, timezone, notification email, policy, PO footer
- [x] Request types, cost centers, form links, users & roles, role-permission matrix, audit log viewer
- [x] Setup wizard
- [~] SMS provider abstraction (Twilio) with opt-in/out; disabled until configured — needs Twilio to verify live

## Phase 7 — Security / Testing / Deployment (§32, §37, §38, §41–§48, §51)
- [x] Security headers (CSP etc.), secrets server-only, `.env.example`
- [x] Unit tests: money, totals, validation, transitions, tokens, webhook signatures, email matching
- [x] DB tests (PGlite, real migrations): RLS, anon lockout, submission, review, PO, orders, reconciliation, statuses
- [x] Demo data (flagged `is_demo`) + removal script
- [x] Lint, typecheck, tests, production build all green
- [x] README.md, SETUP-GUIDE.md (beginner, click-by-click), manual-actions list
- [~] Acceptance checklist (§51) walk-through — automated parts done; live walk-through in SETUP-GUIDE §13
