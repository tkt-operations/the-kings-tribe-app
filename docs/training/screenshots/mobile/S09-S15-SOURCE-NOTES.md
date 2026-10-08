# S09–S15 — source notes (phone alerts and installing the app)

These seven images cover the iPhone part of the training guide. One is a **real capture**; six are **training illustrations** built for this guide. An illustration is not a screenshot and must not be presented as one: each carries a visible "Training illustration" label, and the PNG metadata (`Source-Type`) says the same.

All illustrations use the TKT Training app's real wording (from `components/notifications/push-settings.tsx`), its brand colours and fonts (Satoshi, DM Serif Display), and the official logo and app icon files from `public/brand/` and `public/icons/`, placed unaltered (not redrawn, recoloured or cropped). The phone frame, status bar ("9:41") and backgrounds are illustrative. No real people, personal photos, other apps, device identifiers, push endpoints, tokens or production data appear.

Rendered at 1600 × 1100 (exported at 2×: 3200 × 2200) with a generator script kept outside the repository; the layouts can be reproduced on request.

| S-number | File | Type | Source / reference | Behaviour shown (verified) | May vary by iOS version |
|---|---|---|---|---|---|
| S09 | `S09-phone-notifications-off-graphic.png` | TRAINING ILLUSTRATION | Notifications page, "Phone notifications" card in its off state (`PushSettings`, phase `off`) | The card explains alerts and offers **Enable phone notifications**; on iPhone this works in the installed app | — |
| S10 | `S10-ios-notification-permission-graphic.png` | TRAINING ILLUSTRATION | Simplified representation of the iOS permission prompt — deliberately **not** Apple's exact dialog | iOS asks once, the first time notifications are enabled; tap **Allow** | Prompt wording, layout and button labels |
| S11 | `S11-phone-notifications-enabled-graphic.png` | TRAINING ILLUSTRATION | Notifications page, card in its on state (`PushSettings`, phase `on`): "On for this device.", alert levels, "Your devices" | Device registered; choose "Important & actionable (recommended)" or "Important only"; devices can be removed. Device shown only as a general type ("iPhone") | — |
| S12 | `S12-lock-screen-alert-mobile.png` | **REAL CAPTURE** (framed) | Real iPhone capture taken 8 Oct 2026 during the controlled training push test (TKT-REQ-2026-0046), cropped to the notification only (`S12-lock-screen-alert-source-crop.png`); placed in an illustrated phone frame on a plain background — the personal wallpaper, carrier and other content were removed | "The Kings Tribe from TKT Training — Essential requisition requires review"; tapping it opened that requisition (deep link verified) | Lock-screen layout and grouping |
| S13 | `S13-safari-share-graphic.png` | TRAINING ILLUSTRATION | Training sign-in page at `https://tkt-operations-training.vercel.app` in Safari (no path, query or token) | Open the training site in Safari and tap **Share** | Toolbar position (top/bottom address bar), icon set |
| S14 | `S14-add-to-home-screen-graphic.png` | TRAINING ILLUSTRATION | Simplified Share menu — not Apple's exact design | Choose **Add to Home Screen**, then **Add** | Menu wording, order and position |
| S15 | `S15-tkt-training-home-screen-graphic.png` | TRAINING ILLUSTRATION | Home Screen with the app's real icon (`public/icons/apple-touch-icon.png`) and neutral placeholder tiles (not real apps) | TKT Training appears on the Home Screen; open it from there (not Safari) to sign in and use phone alerts | Icon grid and dock appearance |

Related verified facts (from the training push test, 8 Oct 2026): iOS 16.4 or later is required; web push works only in the app added to the Home Screen; the alert text is generic and never shows amounts, items, names or other details; tapping an alert opens the exact requisition after sign-in.
