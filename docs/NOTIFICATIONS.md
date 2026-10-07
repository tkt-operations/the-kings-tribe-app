# Operational notifications

The in-app Notification Center is the primary channel for internal users.
- **Email** is unchanged: `lib/notify.ts` and the `notifications` email log.
- **Web Push** (Release 2, below) is an optional, best-effort alert on top of the inbox.

## Release 1 — the in-app inbox

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

## Release 2 — Web Push (phone notifications)

### How a push is sent
1. A workflow action commits. Its triggers have already written the inbox rows (Release 1).
2. After the response, the server action calls `schedulePushDispatch()`, which uses Next.js `after()`:
   - for every requisition action, through `refresh()` in `app/(app)/requisitions/[id]/actions.ts`
   - for the requester submission
   - for the inbound-email webhook
3. `dispatchPendingPushes()` (`lib/push/dispatch.ts`) calls `claim_push_batch()`.
   - That function claims each inbox row from the last 30 minutes exactly once (the `push_dispatches` primary key), and marks ineligible rows `skipped`.
   - It returns one row per (notification, device).
4. The server sends each row with `web-push` and VAPID: 10-second timeout, 12-hour TTL, high urgency for high importance.
5. Results go to `record_push_results()`:
   - **404/410** deletes the subscription
   - **other failures** increase a failure count; the subscription is deleted only after 10 in a row
   - **success** resets the count

Nothing in this path can roll back or block the workflow, or change the inbox or email. A missed dispatch (for example a function that stopped early) is picked up by the next one within 30 minutes; older rows are never pushed late. With VAPID unset, push is off and nothing is claimed.

### What is pushed
- **Low importance:** never pushed (in-app only).
- **Push level** (per user, on `/notifications`):
  - **Important & actionable** (the default): high and normal importance.
  - **Important only:** high importance (for example an Essential requisition) and "assigned to you".
- **The recipient** must still be active and hold the row's permission when it is sent.

### Lock-screen content
- The title is always "The Kings Tribe", and the body is one fixed line per event type (`lib/push/payload.ts`), for example "New requisition requires review", "Receipt ready to reconcile" or "Requisition assigned to you".
- It never includes amounts, item descriptions, requester names or contact details, receipt details, financial coding or comments.
- The payload carries only the title, body, an allowlisted in-app path, the notification ID (used as the tag, so repeats replace each other) and the unread count (for the app badge).

### Subscriptions and devices
- `push_subscriptions` holds one row per browser or device subscription. Clients never read it; they use functions that act only for the signed-in user.
- Endpoints must belong to a browser push service: FCM, Mozilla, Apple or Windows. This is checked in the database and in the server, so the server never sends a request anywhere else.
- **Enabling** requires pressing "Enable phone notifications". Permission is never requested automatically.
- **Duplicate saves** of the same browser update the existing row.
- **Ownership transfer:** if another internal user explicitly enables phone notifications on the same browser, it moves to that user. The endpoint and keys exist only in that browser.
- **Turning off:** "Turn off for this device", or remove any device from "Your devices".
- **Signing out does not remove a device's subscription,** so operational alerts can still arrive. The alerts are generic, and opening one still requires signing in before any data is shown. Remove the device on `/notifications` to stop them.
- **Deactivating a user** deletes their subscriptions; dispatch also skips inactive users.

### Service worker (`public/sw.js`)
- The existing caching is unchanged.
- **`push`** shows a plain-text notification (title fixed, text capped at 120 characters) and sets the app badge where supported.
- **`notificationclick`** opens only allowlisted in-app paths: `/requisitions/<uuid>`, `/receipts`, `/dashboard` or `/notifications`. Anything else becomes `/notifications`. It focuses an open app window and navigates it, or opens one.
- Push payloads are not cached.
- `pushsubscriptionchange` is not handled. A changed or expired subscription shows as "not on for this device", and the user turns it on again explicitly.

### App badge
The unread count drives `navigator.setAppBadge` / `clearAppBadge`, from the app and from each push. It is feature-detected and failures are ignored.

### Setting up VAPID (one-time; not done yet)
1. On your own computer, in the project folder, run `npx web-push generate-vapid-keys` in a normal Terminal window.
   - Don't paste the output into chat, and don't run it through a tool that records output.
   - It prints a **Public Key** and a **Private Key**.
2. In Vercel → Project → Settings → Environment Variables, add these for **Production** (and Preview if wanted):
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: the public key
   - `VAPID_PRIVATE_KEY`: the private key (mark as **Sensitive**)
   - `VAPID_SUBJECT`: `mailto:` followed by your operations address
3. Redeploy, because `NEXT_PUBLIC_` values are built into the app.
4. Keep the same key pair from then on. Changing it means every device must turn phone notifications on again.

### Device acceptance (manual; not verified until done on real devices)
- **iPhone/iPad (iOS 16.4 or later):**
  1. Safari → Share → Add to Home Screen, then open the app from the icon and sign in.
  2. Notifications → "Enable phone notifications" → Allow.
  3. Lock the phone and have another user trigger an eligible event (for example a new requisition).
  4. Check that the alert reads "The Kings Tribe — New requisition requires review" and the badge shows the count.
  5. Tap it: after sign-in if needed, you land on the requisition. Mark all as read clears the badge.
  6. "Turn off for this device" stops alerts. A denied permission still leaves the inbox working.
- **Android (Chrome):** install the app (or use the browser), then repeat the same steps.
