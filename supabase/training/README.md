# supabase/training — TRAINING database scripts

For the isolated training environment only. See [docs/training/TRAINING-ENVIRONMENT.md](../../docs/training/TRAINING-ENVIRONMENT.md).

**Never run these with `supabase ... --linked`: this repository's CLI link points at PRODUCTION.**
Run them only through `scripts/training/training-db.sh`, which verifies the training project and asks you to type its ref before any write.

| File | Purpose |
|---|---|
| `guard.sql` | Read-only. Fails unless the church name contains "TRAINING". |
| `seed_training.sql` | Fictional, non-demo training scenarios created through the real workflow functions. Idempotent; aborts unless the guard passes. |
| `reset_scenarios.sql` | Deletes one scenario (or `all`) so it can be re-seeded. Never deletes users, settings or the audit log. |

Scenarios: `priority_mix`, `review_take_1..3`, `ready_for_po`, `ready_for_po_direct`, `ready_to_order`, `receipt_pending`, `partial_purchase`, `advance_due`, `ready_to_close`, `on_hold_example`, `rejected_example`, `partially_approved`, `history`, `sundays`.

Not seeded: **Reimbursement**. The database requires a real uploaded receipt file on submission, so prepare it through the training request form with the sample receipt. Emailed receipts and SMS are not part of the verified training workflow.

Prerequisite: active users Morgan Ellis (Administrator), Taylor Brooks (Head of Finance), Riley Chen (Finance User) and Sam Patel (Reporting User), created in the app with copy-link invitations. Tested locally in PGlite (`tests/db/training-seed.test.ts`, `tests/db/training-sql-execution.test.ts`) and seeded into the training project.

**Dates in `history`:** the older requisitions have backdated **submission** dates (about 1–6 months ago), but their review, status-change and close timestamps are the time the seed ran. Screenshots and video should not present those review or close timestamps as historical. Historical lifecycle dates can be improved separately if Reports need them.
