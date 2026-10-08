# Training assets

Fictional material for the training booklet and videos. Nothing here is real, and nothing here is ever sent.

## `sample-receipt/`
`sample-receipt.png` and `sample-receipt.pdf` are rendered from `sample-receipt.html`: a made-up store ("Fictional Example Supplies"), date, items, amounts and receipt number (`SAMPLE-TRN-0001`), marked **SAMPLE — TRAINING — NOT A REAL RECEIPT** at the top, bottom and across the middle. Use them for the receipt-upload steps (S30, S51, M8). Re-render by opening the HTML in Chromium and capturing the `.receipt` element (PNG, 3×) and printing it at 4 × 7.2 in (PDF).

## `requester-emails/` (S54)
Four requester emails rendered with the app's real email template (`lib/email/layout.ts`) and the same subjects and content `lib/notify.ts` builds, filled with the fictional training records (Jamie Carter, `jamie.carter@demo.invalid`):

| File | Email |
|---|---|
| `01-request-received.png` | Request received (as at submission, before review) |
| `02-partially-approved.png` | Status: Partially Approved, with Finance's comment and per-line notes |
| `03-po-issued.png` | Purchase Order issued |
| `04-purchased.png` | Status: Purchase completed |

They were **rendered, never sent**. A gold strip at the top says so. The personal "manage updates" link is replaced with a placeholder, so no token appears. Training has no inbound receipt address, so the PO email shows the "send each receipt to Finance" wording, as the app does without one.

Regenerate (from the repository root; the capture server must be running for the logo):
```
npx --no-install rolldown scripts/training/emails/render-requester-emails.ts --platform node --format esm -o /tmp/render-emails.mjs   # with "@" aliased to the repo root
node /tmp/render-emails.mjs scripts/training/emails/training-email-data.json <out-dir>
```
then screenshot each HTML file at 720 px wide. `training-email-data.json` is a snapshot of the fictional training records.
