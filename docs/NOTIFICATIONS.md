# Operational notifications — Release 1

The in-app Notification Center is the primary channel for internal users.
- **Email** is unchanged: `lib/notify.ts` and the `notifications` email log.
- **Web Push** is planned for Release 2 and is not implemented.

## Storage
- **`user_notifications`** (migration `20261009000100_user_notifications.sql`) has one row per recipient per event:
  - `type`, `category` (requisitions, purchasing, finance, system) and `importance` (high, normal, low)
  - `title` and `body` (concise: no amounts, item descriptions or requester details)
  - `link`, which must match an allowlist of fixed routes in the database: `/requisitions/<uuid>`, `/receipts`, `/dashboard`, `/notifications`
  - `requisition_id` and `receipt_id`
  - `visible_with`: the permission the recipient must still hold to see the row
  - `event_key`, unique per user, so replaying an event inserts nothing
  - `read_at`, `created_at`
- **Push delivery state is deliberately not stored here.**
- Rows are written only by `SECURITY DEFINER` trigger functions. Clients have `SELECT` on their own rows only, and no insert, update or delete access.

## Recipients
`private.notification_recipients(permission, visible_with, exclude)` returns active profiles holding both permissions. It uses the same rule as `has_permission`, and administrators hold every permission. Inactive users and external requesters (who have no profile) are never recipients, and demo records never notify.

## Event catalog
| Event | When | Recipients (permission) | Actor | Importance |
|---|---|---|---|---|
| `requisition.submitted` | new submission (deferred to commit, so line priorities are final) | `requisitions.review` | external, n/a | high with an Essential line, otherwise normal |
| `requisition.assigned` | reviewer assigned or changed | the assignee (needs `requisitions.review`) | none if self-assigned (starting a review assigns yourself) | normal |
| `requisition.approved` / `requisition.partially_approved` | review decision | next action from the request type: `purchase_orders.issue`, `orders.record`, `disbursements.record` (petty cash, advance) or `receipts.reconcile` (reimbursement) | **included**: the approver may do the next step | normal |
| `requisition.on_hold` | review decision | the assigned reviewer (reviewing self-assigns when nobody was assigned) | excluded if they are the assignee | low |
| `requisition.rejected` | review decision | `requisitions.review` | excluded | low |
| `purchase_order.issued` | PO issued | types with vendor orders: `orders.record` ("ready to order"); otherwise `receipts.reconcile` ("awaiting receipt") | included / excluded | normal / low |
| `purchase_order.voided` | PO voided | `purchase_orders.issue` | excluded | normal |
| `vendor_order.placed` | vendor order recorded | `receipts.reconcile` | excluded | low |
| `vendor_order.cancelled` | vendor order cancelled | `orders.record` | excluded | normal |
| `receipt.received` | receipt uploaded or emailed and matched | `receipts.reconcile` | **included**: the uploader may reconcile it | normal |
| `receipt.unmatched` | emailed receipt not matched | `receipts.reconcile` (row needs `receipts.reconcile`, links to `/receipts`) | n/a | normal |
| `requisition.purchased` | fully purchased | reimbursement: `disbursements.record`; otherwise `requisitions.review` ("ready to close") | **included** | normal / low |
| `requisition.closed` | closed | `requisitions.review` | excluded | low |

**Not notified:** under review, PO issued and ordered as status moves (covered by the PO and vendor-order events), partially purchased, receipts sent with the submission, and automatic moves back to approved after a PO is voided.

**Deferred:** `email.delivery_problem` (needs the Resend delivery webhook) and receipt reconciliation (covered by `requisition.purchased`).

## Needs Attention
`my_needs_attention()` and `needs_attention_requisition_ids(card)` compute live counts and IDs from workflow state, mirroring each workflow function's preconditions and the per-type timeline. A card appears only when the user holds its permission and `requisitions.view`.

| Card | Permission | Rule |
|---|---|---|
| Awaiting review | `requisitions.review` | status submitted or under review (also shows Essential and "assigned to you" counts) |
| On hold | `requisitions.review` | status on hold |
| Ready for PO | `purchase_orders.issue` | type issues POs, approved or partially approved, no issued PO |
| Ready to order | `orders.record` | type allows vendor orders, nothing ordered; after the PO when the type issues POs |
| Awaiting receipts | `receipts.reconcile` | ordered or partially purchased, or a Direct Purchase PO issued, or petty cash/advance paid out, with no pending receipt |
| Ready for disbursement | `disbursements.record` | reimbursement: purchased and not fully repaid; petty cash/advance: approved and nothing paid |
| Receipts to reconcile | `receipts.reconcile` | pending receipts on approved requisitions, plus unmatched receipts |

The requisition list accepts `?attention=<card>` and uses the same database rule.

## Live updates
- `user_notifications` is the **only** table added to the `supabase_realtime` publication, and RLS limits events to the recipient.
- The bell refreshes on Realtime events, on window focus or tab visibility, and every 60 seconds while visible. It works if Realtime is unavailable.

## Manual check after deploying Release 1
1. Sign in as a reviewer, then submit a requisition from a requisition link in another browser.
2. The bell shows **1 unread** within a minute, or immediately with Realtime.
3. Open the bell. Nothing is marked read until you select an item; selecting it opens the requisition and the count drops.
4. **Mark all as read** clears the count; `/notifications` filters and pagination work.
5. The dashboard's **Needs attention** shows the new requisition under *Awaiting review*, and its link opens the filtered list.
