// The Kings Tribe — Operations Platform Training & Onboarding Guide.
// Single source for docs/training/USER-GUIDE.md and the PDF booklet (build.mjs).
// Every statement reflects behaviour verified in the training environment (Oct 2026).
// Paths are relative to docs/training/.

export const META = {
  title: "User Training & Onboarding Guide",
  org: "THE KINGS TRIBE",
  product: "Operations Platform",
  version: "Draft 0.1",
  date: "October 2026",
  support: "[SUPPORT CONTACT TO BE CONFIRMED]",
};

const D = (id, file, caption) => ({ id, src: `screenshots/desktop/${file}`, caption, kind: "desktop", label: "Screenshot" });
const M = (id, file, caption) => ({ id, src: `screenshots/mobile/${file}`, caption, kind: "mobile", label: "Screenshot" });
const G = (id, file, caption, label = "Training illustration") => ({ id, src: `screenshots/mobile/${file}`, caption, kind: "graphic", label });
const E = (id, file, caption) => ({ id, src: `assets/requester-emails/${file}`, caption, kind: "email", label: "Rendered email · not sent" });

// A workflow page: what / who / steps / next / notes + figure(s).
const wf = (o) => ({ type: "workflow", ...o });
const text = (o) => ({ type: "text", ...o });

export const ROLES = [
  ["Administrator", "Full access: everything in this guide, including Administration (setup, settings, users, roles, links, departments, categories, request types, audit log)."],
  ["Head of Finance", "Dashboard · Sunday finance · Requisitions and review · Purchase Orders · vendor orders · Receipts and reconciliation · Disbursements · Reports · Categories · Requisition links · Audit log. No user, role, settings, setup, department or request-type administration."],
  ["Finance User", "Dashboard · Sunday finance entry and view."],
  ["Reporting User", "Dashboard · Sunday attendance entry and view · Reports (Attendance)."],
  ["Viewer", "Dashboard (attendance) only."],
  ["External requester", "No account. Submits requests through a secure requisition link only."],
];

export const SECTIONS = [
  {
    n: 2, title: "How to Use This Guide",
    pages: [text({
      blocks: [
        { p: "This guide walks through the Operations Platform one task at a time. Each task page follows the same pattern:" },
        { list: ["<b>What this does</b> — the purpose of the screen or action.", "<b>Who can do it</b> — the roles that see it.", "<b>Step-by-step</b> — numbered actions in the app.", "<b>What happens next</b> — the result and any follow-on work.", "<b>Important notes</b> — rules, limits and tips."] },
        { p: "All screens in this guide were captured from a <b>separate training environment</b> that contains only fictional people, requests and amounts. Training screens show a gold <b>TRAINING ENVIRONMENT · FICTIONAL DATA</b> banner and the app name <b>TKT Training</b>; the live (production) system does not show the training banner." },
        { p: "Request numbers shown in this guide (for example TKT-REQ-2026-0043) are fictional training examples." },
        { callout: "note", text: "Figure labels tell you what each image is: <b>Screenshot</b> (captured from the app), <b>Real capture</b> (captured on a phone), <b>Training illustration</b> (a drawn guide to a phone or iOS screen — not a screenshot), or <b>Rendered email</b> (produced from the real email template and never sent)." },
        { callout: "tip", text: "Not sure what you can see? Start with Section 3, Roles & Access Overview, then Section 15, Role Quick Reference." },
        { h: "Conventions" },
        { list: ["<b>Bold</b> text matches a button, menu or field in the app.", "“Requisition” and “request” mean the same thing.", "Times and dates follow the church’s configured timezone."] },
      ],
    })],
  },
  {
    n: 3, title: "Roles & Access Overview",
    pages: [text({
      blocks: [
        { p: "Every staff member signs in with their own account and one or more roles. The menu shows only what your roles allow; pages you cannot use are not shown, and opening one directly shows a “not allowed” page." },
        { table: { head: ["Role", "Access"], rows: ROLES } },
        { callout: "important", text: "Department and ministry leads do not get accounts. They send requests through a secure <b>requisition link</b> that can only submit requests — they never see finances, other requests or anything internal." },
        { p: "Administrators assign roles in <b>Administration → Users</b>. Role names are fixed in the app and are used throughout this guide." },
      ],
    })],
  },
  {
    n: 4, title: "Getting Started",
    pages: [
      wf({
        title: "Sign in", what: "Opens your account. Your roles decide what you see after signing in.", who: "All staff with an account.",
        steps: ["Open the Operations Platform address provided by your administrator.", "Enter your <b>Email address</b> and <b>Password</b>.", "Tap <b>Sign in</b>."],
        next: "Your Dashboard opens. If you opened a direct link before signing in, you are taken there instead.",
        notes: ["Accounts are created by invitation only — there is no self sign-up.", "On a phone, install the app first if you want phone alerts (later in this section)."],
        figs: [D("S01", "S01-login-desktop.png", "Sign in (desktop)"), M("S01", "S01-login-mobile.png", "Sign in (phone)")], layout: "desktop+mobile",
      }),
      wf({
        title: "Forgot password", what: "Requests a password reset for your account.", who: "All staff with an account.",
        steps: ["On the sign-in page, tap <b>Forgot your password?</b>", "Enter your account <b>Email address</b>.", "Tap <b>Send reset link</b> to submit the reset request.", "Follow the instructions provided by the sign-in service to choose a new password."],
        next: "The page says it will send you a secure link to choose a new password. Once you have set it, sign in. <b>Back to sign in</b> returns to the sign-in page.",
        notes: ["Delivery of the reset message depends on the configured authentication email service.", "In the training environment this form is shown but not submitted."],
        figs: [D("S02", "S02-forgot-password-desktop.png", "Reset password")],
      }),
      wf({
        title: "Install the app on iPhone", what: "Adds the Operations Platform to your Home Screen so it opens like an app. Required for phone alerts on iPhone.", who: "Any staff member using an iPhone (iOS 16.4 or later).",
        steps: ["Open the platform address in <b>Safari</b>.", "Tap <b>Share</b>.", "Choose <b>Add to Home Screen</b>, then <b>Add</b>.", "Open the app from the Home Screen and sign in there."],
        next: "The app opens full-screen. Continue to “Enable phone notifications”.",
        notes: ["The installed app does not share Safari’s sign-in — sign in again inside it.", "Share-menu wording and position may vary by iOS version. Full illustrated steps: Section 13."],
        figs: [G("S13", "S13-safari-share-graphic.png", "Tap Share in Safari")],
      }),
      wf({
        title: "Enable phone notifications", what: "Lets this device show short alerts when something needs your attention.", who: "Any staff member, on each device they use.",
        steps: ["Open <b>Notifications</b> (bell → <b>View all notifications</b>).", "In the <b>Phone notifications</b> card, tap <b>Enable phone notifications</b>.", "When the device asks, tap <b>Allow</b>."],
        next: "The card shows <b>On for this device.</b> and lists your devices.",
        notes: ["On iPhone this works only in the app added to the Home Screen.", "Alerts show only a short message; details open in the app after you sign in.", "Full illustrated steps and alert levels: Section 13."],
        figs: [G("S09", "S09-phone-notifications-off-graphic.png", "The Phone notifications card")],
      }),
    ],
  },
  {
    n: 5, title: "Dashboard & Navigation",
    pages: [
      wf({
        title: "Dashboard", what: "Your starting page: work that needs attention, this Sunday’s entry and the latest attendance and giving figures.", who: "All staff. Each role sees only its own cards and figures.",
        steps: ["Sign in — the Dashboard opens.", "Use <b>Needs attention</b> cards to jump to waiting work.", "Use <b>Enter this Sunday</b> to record the current service.", "Change the period (4 weeks, 12 weeks, this month, quarter, year to date or custom) to update figures and charts."],
        next: "Tap any card to open the matching filtered list.",
        notes: ["A Viewer sees attendance figures only (second image)."],
        figs: [D("S03", "S03-dashboard-administrator-desktop.png", "Dashboard — Administrator"), D("S04", "S04-dashboard-viewer-desktop.png", "Dashboard — Viewer")], layout: "two-desktop",
      }),
      wf({
        title: "Phone navigation", what: "On a phone, the main sections sit in a bottom bar.", who: "All staff.",
        steps: ["Use the bottom bar for <b>Dashboard</b>, <b>Sunday</b> and <b>Requisitions</b>.", "Tap <b>More</b> for the other sections your role allows.", "Use the top bar for the bell and sign out."],
        next: "The More menu lists only the sections you can use and shows who is signed in.",
        notes: ["Menus differ by role — if a section is missing, your role does not include it."],
        figs: [M("S05", "S05-navigation-more-mobile.png", "Bottom bar and More menu")], layout: "mobile",
      }),
      wf({
        title: "Notifications", what: "In-app notifications tell you when work arrives or changes.", who: "All staff.",
        steps: ["Tap the <b>bell</b> to see recent notifications; the badge shows how many are unread.", "Tap a notification to open it — it is marked read.", "Tap <b>Mark all as read</b> or <b>View all notifications</b>.", "On the Notifications page, filter by <b>All</b>, <b>Unread</b>, <b>Requisitions</b>, <b>Purchasing</b>, <b>Finance</b> or <b>System</b>."],
        next: "Each notification opens the exact page it refers to.",
        notes: ["Important items are labelled <b>Important</b>.", "Notifications are always available here, even if phone alerts are off."],
        figs: [D("S06", "S06-bell-panel-desktop.png", "Bell panel"), D("S07", "S07-notifications-desktop.png", "Notifications page")], layout: "two-desktop",
      }),
      wf({
        title: "Notifications on a phone", what: "The same Notifications page, sized for a phone.", who: "All staff.",
        steps: ["Tap <b>More</b>, or tap the bell and choose <b>View all notifications</b>.", "Scroll the filter chips sideways to change the view."],
        next: "Tap any notification to open its page.",
        notes: ["Phone alerts (Section 13) are set up from this page."],
        figs: [{ ...G("S07", "S07-notifications-mobile.png", "Notifications on a phone"), label: "Training illustration" }], layout: "mobile",
      }),
      wf({
        title: "Needs Attention", what: "Counts of work waiting for your action, each opening a filtered list.", who: "Roles that act on requisitions (Administrator, Head of Finance).",
        steps: ["On the Dashboard, find <b>Needs attention</b>.", "Tap a card — for example <b>Awaiting review</b>.", "Work through the filtered list; open a requisition to act on it."],
        next: "Counts update as work moves on. Cards include Awaiting review, Receipts to reconcile, Ready for PO, Ready to order, Ready for disbursement, Awaiting receipts and On hold.",
        notes: ["Awaiting review highlights Essential items and requests assigned to you."],
        figs: [D("S08", "S08-needs-attention-filtered-desktop.png", "Awaiting review — filtered list")],
      }),
    ],
  },
  {
    n: 6, title: "Sunday Reporting",
    pages: [
      wf({
        title: "Sunday entry", what: "Records attendance and finance received for a service.", who: "Attendance: Administrator, Reporting User. Finance: Administrator, Head of Finance, Finance User.",
        steps: ["Open <b>Sunday Entry</b> (or <b>Enter this Sunday</b> on the Dashboard).", "Check the <b>Service date</b> and <b>Service</b>.", "Enter attendance by category and/or finance by category.", "Tap <b>Save Sunday entry</b>."],
        next: "The service appears under <b>Recent services</b> and in Dashboard and Reports figures.",
        notes: ["You see only the sections your role allows.", "Totals are recalculated by the server when you save.", "The badge shows <b>New entry</b> or <b>Editing saved entry</b>."],
        figs: [D("S16", "S16-sunday-entry-new-desktop.png", "New Sunday entry")],
      }),
      wf({
        title: "Finance entry and notes", what: "Records amounts received per finance category, with an optional note per line.", who: "Administrator, Head of Finance, Finance User.",
        steps: ["Enter each amount in the church’s currency; leave blank if nothing was received.", "Tap the note icon beside a category to <b>Add a note</b>.", "Check <b>Total finance received</b>.", "Tap <b>Save Sunday entry</b>."],
        next: "Totals and figures update for that service.",
        notes: ["Attendance works the same way: enter a headcount per category and check <b>Total attendance</b> (Administrator, Reporting User)."],
        figs: [D("S17", "S17-sunday-finance-note-desktop.png", "Attendance and finance with a note")],
      }),
      wf({
        title: "Editing previous services", what: "Corrects a service that was already saved.", who: "Same roles as Sunday entry.",
        steps: ["On <b>Sunday Entry</b>, scroll to <b>Recent services</b>.", "Select the service to review or correct.", "Change the values and tap <b>Save Sunday entry</b>."],
        next: "The saved entry is updated; Dashboard and Reports reflect the change.",
        notes: ["The badge reads <b>Editing saved entry</b> while you change an existing service."],
        figs: [D("S18", "S18-sunday-edit-existing-desktop.png", "Editing a saved service")],
      }),
    ],
  },
  {
    n: 7, title: "Requisitions",
    pages: [
      wf({
        title: "Requisition list", what: "All requests in one place, newest first, with filters.", who: "Administrator, Head of Finance.",
        steps: ["Open <b>Requisitions</b>.", "Filter by status, department, request type or priority; sort by <b>Priority (Essential first)</b> if needed.", "Tap a requisition number to open it."],
        next: "The detail page opens with everything about the request.",
        notes: ["Each row shows the requester, department, request type, needed date, estimated total, status, reviewer and highest priority.", "Submitted dates follow the church’s timezone."],
        figs: [D("S19", "S19-requisitions-list-desktop.png", "Requisition list")],
      }),
      wf({
        title: "Requisitions on a phone", what: "The list as cards for small screens.", who: "Administrator, Head of Finance.",
        steps: ["Tap <b>Requisitions</b> in the bottom bar.", "Use the filters at the top, then tap a card."],
        next: "The same detail page opens.",
        notes: ["Cards show the essentials; open one for full details."],
        figs: [M("S19", "S19-requisitions-list-mobile.png", "Requisition cards")], layout: "mobile",
      }),
      wf({
        title: "Requisition detail", what: "Shows the request, its progress and the actions available now.", who: "Administrator, Head of Finance.",
        steps: ["Open a requisition from the list.", "Read the status badge, submitted date and needed date.", "Follow the progress bar. A typical Order path is Submitted → Under Review → Approved → PO Issued → Ordered → Receipt Received → Purchased → Closed.", "Use the action buttons at the top."],
        next: "Actions appear only when they apply to the current status.",
        notes: ["Statuses and steps vary by decision and request type; for example, a request may be On Hold, Partially Approved or Rejected, and Advance Check includes Check Issued."],
        figs: [D("S20", "S20-requisition-detail-header-desktop.png", "Detail header and progress")],
      }),
      wf({
        title: "Priorities and Essential items", what: "Each line has a priority: <b>Essential</b>, <b>High</b>, <b>Medium</b> or <b>Low</b>. Essential lines include the requester’s reason.", who: "Administrator, Head of Finance.",
        steps: ["Open a requisition and scroll to <b>Line items</b>.", "Read the priority badge on each line.", "For Essential lines, read <b>Why essential</b>."],
        next: "Use priority to decide what to review first.",
        notes: ["Priority is information only — you can still approve, hold or reject any item.", "Requests with Essential items are highlighted in lists and alerts."],
        figs: [D("S21", "S21-essential-line-item-desktop.png", "Essential line with its reason")],
      }),
      wf({
        title: "Change an item’s priority", what: "Corrects the priority of one line.", who: "Administrator, Head of Finance.",
        steps: ["On a line, tap <b>Change</b> next to its priority.", "Choose the new priority.", "If you choose Essential, explain <b>Why is this item essential?</b>", "Tap <b>Save priority</b>."],
        next: "The new priority shows on the line.",
        notes: ["The change is recorded in the audit history. It does not approve or reject the item."],
        figs: [D("S22", "S22-change-item-priority-desktop.png", "Change item priority")],
      }),
      wf({
        title: "Start review", what: "Shows the team you are reviewing a request and moves it to <b>Under Review</b>.", who: "Administrator, Head of Finance.",
        steps: ["Open a <b>Submitted</b> requisition.", "Tap <b>Start review</b>."],
        next: "The status becomes Under Review and you are recorded as reviewer.",
        notes: ["You can also go straight to <b>Review</b> without starting a review first."],
        figs: [D("S23", "S23-start-review-button-desktop.png", "Start review on a Submitted request")],
      }),
      wf({
        title: "Assign a reviewer and add comments", what: "Records who owns the review and keeps internal notes.", who: "Administrator, Head of Finance.",
        steps: ["In the <b>Review</b> panel, choose the <b>Assigned reviewer</b>.", "Under <b>Internal comments</b>, type an <b>Internal comment</b>.", "Tap <b>Add comment</b>."],
        next: "The assigned person is notified. Comments appear with name and time.",
        notes: ["Internal comments are visible to staff only — never to the requester."],
        figs: [D("S23", "S23-assigned-reviewer-comment-desktop.png", "Assigned reviewer and internal comments")],
      }),
      wf({
        title: "Review: approve all", what: "Approves every line, optionally adjusting quantities or prices.", who: "Administrator, Head of Finance.",
        steps: ["Tap <b>Review</b>.", "Choose <b>Approve</b>.", "Adjust <b>Approved qty</b> or <b>Unit price</b> if needed; add coding (budget line, expense category).", "Tap <b>Save decision</b>."],
        next: "The status becomes <b>Approved</b> and the request appears under Ready for PO (or the next step for its type). If requester notifications are configured, the requester may also receive an update.",
        notes: ["Decisions: <b>Approve</b>, <b>Partially approve</b>, <b>Hold</b> (comment required) and <b>Reject</b> (comment required)."],
        figs: [D("S24", "S24-review-approve-all-desktop.png", "Finance review — Approve")],
      }),
      wf({
        title: "Review: mixed decisions", what: "Approves some lines and holds or rejects others.", who: "Administrator, Head of Finance.",
        steps: ["Tap <b>Review</b> and choose <b>Partially approve</b>.", "For each line choose <b>Approve</b>, <b>Hold</b> or <b>Reject</b>.", "Reduce <b>Approved qty</b> where only part is approved.", "Give a <b>Reason</b> for each held or rejected line, then tap <b>Save decision</b>."],
        next: "The request becomes <b>Partially Approved</b>. The saved decision records which lines were approved and the reasons for held or rejected lines.",
        notes: ["Lines approved at a lower quantity count as partial approval.", "If requester notifications are configured, the requester may receive the decision by email."],
        figs: [D("S25", "S25-review-mixed-decisions-desktop.png", "Partial approval with per-line decisions")],
      }),
      wf({
        title: "Partially Approved result", what: "Shows the outcome of a partial approval.", who: "Administrator, Head of Finance.",
        steps: ["Open the requisition after saving the review.", "Check each line’s <b>Decision</b>, approved quantity and Finance note."],
        next: "Only approved quantities can go on a Purchase Order. Use <b>Issue PO</b> to continue.",
        notes: ["Rejected lines show the reason given in review."],
        figs: [D("S26", "S26-partially-approved-desktop.png", "Partially Approved requisition")],
      }),
    ],
  },
  {
    n: 8, title: "Purchase Orders & Ordering",
    pages: [
      wf({
        title: "Issue a Purchase Order", what: "Creates a Purchase Order (PO) for approved quantities and a branded PDF.", who: "Administrator, Head of Finance.",
        steps: ["Open an approved requisition and tap <b>Issue PO</b>.", "Tick the lines to include and check quantities and prices.", "Add vendor details and notes if known.", "Tap <b>Issue PO</b>."],
        next: "The status becomes <b>PO Issued</b> and the PO appears on the requisition. The confirmation tells you whether the PO was emailed to the requester; if it was not, download the PDF and share it.",
        notes: ["Only approved quantities not already on a PO can be included.", "The PO is issued even when email is not set up; the confirmation message says whether it was emailed.", "Vendor details are optional when items come from several vendors."],
        figs: [D("S27", "S27-issue-purchase-order-desktop.png", "Issue Purchase Order")],
      }),
      wf({
        title: "The PO card", what: "Shows each Purchase Order with its PDF and actions.", who: "Administrator, Head of Finance.",
        steps: ["Open the requisition and scroll to <b>Purchase Orders</b>.", "Download the PDF to share or print it.", "Use <b>Void PO</b> (with a reason) if a PO must be withdrawn."],
        next: "A voided PO stays on record but no longer authorizes purchases.",
        notes: ["All Purchase Orders are also listed on the <b>Purchase Orders</b> page."],
        figs: [D("S28", "S28-po-card-desktop.png", "Purchase Order card")],
      }),
      wf({
        title: "Record a vendor order", what: "Records what was actually ordered — all or part of each line.", who: "Administrator, Head of Finance.",
        steps: ["Tap <b>Record order</b>.", "Enter the <b>Vendor</b>, <b>Vendor order / reference #</b>, <b>Order date</b> and optional <b>Expected delivery</b>; choose the <b>Purchase Order</b>.", "Enter <b>Qty ordered</b> and <b>Unit price</b> for each line.", "Add notes and tap <b>Record order</b>."],
        next: "The status becomes <b>Ordered</b>. Remaining quantities can be ordered later, from one or more vendors.",
        notes: ["Use <b>Cancel order</b> on an order if it was recorded in error; quantities return to “not yet ordered”."],
        figs: [D("S29", "S29-record-vendor-order-partial-desktop.png", "Record vendor order (partial)")],
      }),
    ],
  },
  {
    n: 9, title: "Receipts, Reconciliation & Closing",
    pages: [
      wf({
        title: "Upload a receipt", what: "Attaches receipt files to a requisition.", who: "Administrator, Head of Finance.",
        steps: ["Open the requisition and tap <b>Upload receipt</b>.", "Tap <b>Take a photo or choose files</b>.", "Check the <b>Purchase Order</b>, <b>Vendor</b>, <b>Purchase date</b>, <b>Receipt total</b> and <b>Receipt / invoice #</b>.", "Tap <b>Upload receipt</b>."],
        next: "The receipt waits for reconciliation. Uploading does not mark anything purchased.",
        notes: ["PDF, JPEG, PNG or HEIC · up to 10 MB each · up to 5 files.", "Receipts are stored privately."],
        figs: [D("S30", "S30-upload-receipt-desktop.png", "Upload receipt (desktop)"), M("S30", "S30-upload-receipt-mobile.png", "Upload receipt (phone)")], layout: "desktop+mobile",
      }),
      wf({
        title: "Reconcile a receipt", what: "Records what a receipt actually covers, line by line.", who: "Administrator, Head of Finance.",
        steps: ["On a pending receipt, tap <b>Reconcile</b>.", "For each line on the receipt, enter <b>Qty bought</b> and <b>Actual cost</b>; leave other lines blank.", "Check the variance and the allocated total.", "Tap <b>Confirm reconciliation</b>."],
        next: "Purchased quantities and actual costs update. When everything approved is purchased, the status becomes <b>Purchased</b>; otherwise <b>Partially Purchased</b>.",
        notes: ["Use <b>Reject receipt</b> for duplicates, unreadable images or receipts that don’t belong to the request."],
        figs: [D("S31", "S31-reconcile-receipt-desktop.png", "Reconcile receipt")],
      }),
      wf({
        title: "Won’t buy rest (partial purchase)", what: "Marks approved quantity that will not be bought, so the request can complete.", who: "Administrator, Head of Finance.",
        steps: ["On a Partially Purchased line, tap <b>Won’t buy rest</b>.", "Enter the <b>Quantity not to purchase</b> (up to the remaining quantity).", "Give a <b>Reason</b> and tap <b>Cancel remaining</b>."],
        next: "Remaining quantities update; when nothing is left to buy, the request can move to Purchased.",
        notes: ["The reason is kept with the requisition."],
        figs: [D("S32", "S32-wont-buy-rest-desktop.png", "Cancel remaining quantity")],
      }),
      wf({
        title: "Receipts page", what: "One queue of receipts waiting for reconciliation across all requisitions.", who: "Administrator, Head of Finance.",
        steps: ["Open <b>Receipts</b>.", "Open a waiting receipt and reconcile it from its requisition."],
        next: "Reconciled receipts leave the queue.",
        notes: ["The page also has a section for receipts that arrive by email and cannot be matched automatically. Emailed receipts are a concept only in this training: they are not part of the verified training workflow."],
        figs: [D("S33", "S33-receipts-desktop.png", "Receipts page")],
      }),
      wf({
        title: "Record a disbursement", what: "Records money paid out — a check, cash or reimbursement.", who: "Administrator, Head of Finance.",
        steps: ["Open the requisition and tap the payout button (for example <b>Record check issued</b> for an Advance Check).", "Enter the <b>Amount</b>, <b>Method</b> (Cash, Check, Bank transfer or Other) and <b>Date paid</b>.", "Add a <b>Check # / reference</b> and notes.", "Tap <b>Save</b>."],
        next: "The disbursed total updates. The dialog shows how much remains within the approved amount.",
        notes: ["Petty Cash and Advance Check are paid before purchase; Reimbursements are repaid after purchase."],
        figs: [D("S34", "S34-disbursement-desktop.png", "Record check issued")],
      }),
      wf({
        title: "Close a requisition", what: "Marks a request as finished.", who: "Administrator, Head of Finance.",
        steps: ["Open a <b>Purchased</b> requisition.", "Tap <b>Close requisition</b>.", "Add a comment if needed and tap <b>Close requisition</b> to confirm."],
        next: "The status becomes <b>Closed</b>; no further action is needed.",
        notes: ["If purchasing is not complete, a comment explaining why is required."],
        figs: [D("S35", "S35-close-requisition-desktop.png", "Close requisition")],
      }),
    ],
  },
  {
    n: 10, title: "Reports",
    pages: [wf({
      title: "Reports", what: "Attendance, finance and requisition reporting for any period, with CSV export.", who: "Administrator and Head of Finance (all tabs). Reporting User (Attendance).",
      steps: ["Open <b>Reports</b>.", "Choose a tab: <b>Attendance</b>, <b>Finance</b> or <b>Requisitions & purchasing</b>.", "Set <b>From</b> / <b>To</b> or use <b>Last 4 weeks</b>, <b>Year to date</b> or <b>Last 12 months</b>; choose weekly, monthly, quarterly or yearly grouping.", "Tap <b>Apply</b>. Use <b>Export CSV</b> to download."],
      next: "Figures and charts update for the chosen period.",
      notes: ["CSV dates follow the church’s timezone."],
      figs: [D("S36", "S36-reports-desktop.png", "Reports — Attendance")],
    })],
  },
  {
    n: 11, title: "Administration",
    pages: [
      wf({
        title: "Setup wizard", what: "Guides first-time setup: church information, notification email and policies, categories, departments, team and a requisition link.", who: "Administrator.",
        steps: ["Open <b>Administration → Setup wizard</b>.", "Complete each step; required steps are marked.", "Tap <b>Mark setup complete</b> when all required steps are done."],
        next: "The setup reminder disappears. Every step can be revisited later from Administration.",
        notes: ["Inviting your team is recommended, not required."],
        figs: [D("S37", "S37-setup-wizard-desktop.png", "Setup wizard")],
      }),
      wf({
        title: "Church settings", what: "Church name, address, contact details, currency, timezone, notification email and policy text shown on forms, emails and Purchase Orders.", who: "Administrator.",
        steps: ["Open <b>Administration → Church settings</b>.", "Update the details.", "Tap <b>Save settings</b>."],
        next: "New forms, emails and POs use the updated details.",
        notes: ["The timezone decides what “today” and “this Sunday” mean."],
        figs: [D("S38", "S38-church-settings-desktop.png", "Church settings")],
      }),
      wf({
        title: "Users", what: "Invites team members, assigns roles and deactivates accounts.", who: "Administrator.",
        steps: ["Open <b>Administration → Users</b>.", "Tap <b>Invite user</b>; enter <b>Full name</b>, <b>Email address</b> and roles.", "Choose <b>Send an invitation email</b> or <b>Give me a link to send myself</b>, then tap <b>Invite</b>.", "Tick or untick roles on any user; use <b>Deactivate</b> / <b>Reactivate</b> as needed."],
        next: "The new user shows <b>Invitation pending</b> until they set a password. Deactivated users show <b>Deactivated</b> and are signed out.",
        notes: ["The last active Administrator cannot be removed or deactivated.", "A copy link can be used once; send it privately."],
        figs: [D("S39", "S39-users-desktop.png", "Users — pending and deactivated examples")],
      }),
      wf({
        title: "Roles & permissions", what: "Shows what each role can do.", who: "Administrator.",
        steps: ["Open <b>Administration → Roles & permissions</b>.", "Review the permissions for each role."],
        next: "Use the grid to see which permissions each role includes.",
        notes: ["Use the built-in role names in this guide when assigning roles."],
        figs: [D("S40", "S40-roles-permissions-desktop.png", "Roles & permissions")],
      }),
      wf({
        title: "Requisition links", what: "Secure links department leads use to submit requests — nothing else.", who: "Administrator, Head of Finance.",
        steps: ["Open <b>Administration → Requisition links</b>.", "Tap <b>New requisition link</b>; set a <b>Label</b>, optional department limit, <b>Expires after (days)</b> and <b>Max submissions</b>.", "Tap <b>Create link</b> and copy the link immediately."],
        next: "The link is listed with its status, expiry and submissions used.",
        notes: ["Only a fingerprint of the link is stored — the full link cannot be shown again. If it is lost, use <b>Replace link</b>.", "Treat a link like a key. In these images the link is masked."],
        figs: [D("S41", "S41-requisition-links-desktop.png", "Requisition links (link masked)"), D("S41", "S41-new-link-dialog-desktop.png", "New requisition link")], layout: "two-desktop",
      }),
      wf({
        title: "Replace or revoke a link", what: "Replaces a lost or shared link, or stops a link working.", who: "Administrator, Head of Finance.",
        steps: ["On a link, tap <b>Replace link</b> to issue a new one, or <b>Revoke</b> to stop it.", "Read the confirmation and confirm."],
        next: "Replacing revokes the old link and shows the new link once. Revoking stops submissions immediately.",
        notes: ["Anyone using a revoked link sees “This link isn’t active” (Section 12)."],
        figs: [D("S42", "S42-replace-link-dialog-desktop.png", "Replace link"), D("S42", "S42-revoke-link-dialog-desktop.png", "Revoke link")], layout: "two-desktop",
      }),
      wf({
        title: "Departments and Categories", what: "Departments and subcategories appear on the request form; categories drive Sunday entry and expense coding.", who: "Departments: Administrator. Categories: Administrator, Head of Finance.",
        steps: ["Open <b>Departments</b> or <b>Categories</b>.", "Add, rename, reorder or archive items."],
        next: "Changes appear on forms and in Sunday entry.",
        notes: ["Archive rather than delete items that have history."],
        figs: [D("S43", "S43-departments-desktop.png", "Departments"), D("S43", "S43-categories-desktop.png", "Categories")], layout: "two-desktop",
      }),
      wf({
        title: "Request types", what: "Sets the rules for each request type (Order, Direct Purchase / Purchase Order, Reimbursement, Petty Cash, Advance Check).", who: "Administrator.",
        steps: ["Open <b>Administration → Request types</b>.", "Tap the edit icon on a type.", "Adjust its rules and workflow, then save."],
        next: "The request form and requisition steps follow the new rules.",
        notes: ["Rules decide, for example, whether a PO is issued and whether a receipt is required on submission."],
        figs: [D("S44", "S44-request-type-editor-desktop.png", "Request type editor")],
      }),
      wf({
        title: "Audit log", what: "A permanent record of important changes: who, what and when, with before/after details.", who: "Administrator, Head of Finance.",
        steps: ["Open <b>Administration → Audit log</b>.", "Filter the entries.", "Expand <b>Before / after</b> to see what changed."],
        next: "Entries cannot be edited or deleted.",
        notes: ["Use the audit log to answer “who changed this, and when?”."],
        figs: [D("S45", "S45-audit-log-desktop.png", "Audit log")],
      }),
    ],
  },
  {
    n: 12, title: "External Requester Guide",
    intro: "For department and ministry leads. You don’t need an account — you use the secure requisition link your Finance team sends you.",
    pages: [
      wf({
        title: "About you", what: "Starts a request through your secure link.", who: "Anyone with an active requisition link.",
        steps: ["Open the requisition link.", "Read the requisition policy at the top.", "Complete <b>About you</b>: your full name, email, phone and department head."],
        next: "Continue to Department & timing.",
        notes: ["If requester email notifications are configured, updates may be sent to the email you enter.", "Do not share your link."],
        figs: [D("S46", "S46-request-form-about-you-desktop.png", "About you (desktop)"), M("S46", "S46-request-form-about-you-mobile.png", "About you (phone)")], layout: "desktop+mobile",
      }),
      wf({
        title: "Department, timing and request type", what: "Says who the request is for, when it’s needed and how it will be paid for.", who: "Requesters.",
        steps: ["Choose your <b>Department</b> and <b>Subcategory</b>.", "Set <b>Date items / funds are needed</b>.", "Choose the <b>Request type</b> — read the description under each option."],
        next: "The rest of the form adapts to the request type.",
        notes: ["<b>Date submitted</b> is recorded automatically when you submit."],
        figs: [D("S47", "S47-department-timing-type-desktop.png", "Department, timing and request type"), M("S47", "S47-department-timing-type-mobile.png", "On a phone")], layout: "desktop+mobile",
      }),
      wf({
        title: "Items and product links", what: "Lists what you need. A product link can fill in details for you.", who: "Requesters.",
        steps: ["Under <b>Items requested</b>, optionally paste a <b>Product link</b> and tap <b>Get details</b>.", "Check or enter the description, specifications, brand, model, quantity and estimated price.", "Tap <b>Add Item</b> for more lines."],
        next: "The estimated requisition total updates as you go.",
        notes: ["Product details are filled in only where they can be found; always check them."],
        figs: [D("S48", "S48-product-link-desktop.png", "Product link"), M("S48", "S48-product-link-mobile.png", "On a phone")], layout: "desktop+mobile",
      }),
      wf({
        title: "Check fetched product details", what: "Shows what <b>Get details</b> found and anything you must check.", who: "Requesters.",
        steps: ["Read the message under the product link.", "Check fields marked <b>FILLED</b>.", "Enter anything missing — for example the price when a page lists more than one."],
        next: "Continue with priority and the rest of the form.",
        notes: ["This image shows a <b>simulated training result</b> (no real retailer was contacted). Real results vary by website."],
        figs: [D("S49", "S49-product-details-warning-desktop.png", "Fetched details with a price warning (simulated training result)")],
      }),
      wf({
        title: "Priority and “Why essential”", what: "Tells Finance how urgent each item is.", who: "Requesters.",
        steps: ["Choose a <b>Priority</b> for each item: Essential, High, Medium or Low.", "If you choose <b>Essential</b>, explain <b>Why is this item essential?</b>"],
        next: "Finance sees your priority and reason when reviewing.",
        notes: ["Essential: required to perform a necessary function or avoid a significant operational disruption. Use “What do the priorities mean?” for all definitions."],
        figs: [D("S50", "S50-priority-why-essential-desktop.png", "Priority and Essential reason"), M("S50", "S50-priority-why-essential-mobile.png", "On a phone")], layout: "desktop+mobile",
      }),
      wf({
        title: "Reimbursement and receipts", what: "For purchases you already made: records what you paid and attaches the receipt.", who: "Requesters choosing <b>Reimbursement</b>.",
        steps: ["Choose <b>Reimbursement</b> as the request type.", "Enter <b>Actual amount paid</b>, <b>Vendor</b> and <b>Purchase date</b>.", "Under <b>Itemized receipt</b>, tap <b>Take a photo or choose a file</b>."],
        next: "The receipt uploads when you submit.",
        notes: ["An itemized receipt is required for reimbursement.", "PDF, JPEG, PNG or HEIC · up to 10 MB each · max 5.", "The receipt shown is a sample marked “SAMPLE — TRAINING — NOT A REAL RECEIPT”."],
        figs: [M("S51", "S51-reimbursement-receipt-mobile.png", "Reimbursement with a receipt attached")], layout: "mobile",
      }),
      wf({
        title: "Certification and submit", what: "Confirms the request is accurate and sends it.", who: "Requesters.",
        steps: ["Describe the purpose under <b>Purpose / ministry justification</b>.", "Tick the certification and type <b>Your name</b>.", "Tap <b>Submit requisition</b>."],
        next: "Your request goes to the Finance team for review.",
        notes: ["Your certification is recorded with the date and time of submission. It is not a legally binding electronic signature.", "SMS functionality is not included in the currently verified training workflow."],
        figs: [D("S52", "S52-certification-submit-desktop.png", "Certification & updates"), M("S52", "S52-certification-submit-mobile.png", "On a phone")], layout: "desktop+mobile",
      }),
      wf({
        title: "Request submitted", what: "Confirms your request and gives you its number.", who: "Requesters.",
        steps: ["Note your requisition number (for example TKT-REQ-2026-0043).", "Check the summary: department, type, submitted date, date needed and items."],
        next: "Finance reviews the request. You can submit another with the same link if it is still active.",
        notes: ["The page says a confirmation was emailed only when the email was actually sent. Otherwise it asks you to keep the number for reference."],
        figs: [M("S53", "S53-request-submitted-mobile.png", "Request submitted")], layout: "mobile",
      }),
      wf({
        title: "Emails you may receive", what: "When requester email notifications are configured, requesters may receive updates as the request moves on.", who: "Requesters.",
        steps: ["“We received your request” after submitting.", "A status update when it is approved, partially approved, on hold or rejected.", "“Purchase Order issued” with the PO when one is issued.", "“Purchase completed” when everything is reconciled."],
        next: "Use the link at the bottom of an email to manage your email updates.",
        notes: ["These images are rendered from the real email templates with fictional data and were never sent."],
        figs: [E("S54", "01-request-received.png", "Request received"), E("S54", "02-partially-approved.png", "Partially approved")], layout: "two-email",
      }),
      wf({
        title: "Purchase Order and purchase emails", what: "Later updates for the same request.", who: "Requesters.",
        steps: ["Keep the PO email and give its details to the vendor if you are buying.", "Keep itemized receipts for every purchase."],
        next: "Finance reconciles receipts and closes the request.",
        notes: ["These images are rendered from the real email templates with fictional data and were never sent."],
        figs: [E("S54", "03-po-issued.png", "Purchase Order issued"), E("S54", "04-purchased.png", "Purchase completed")], layout: "two-email",
      }),
      wf({
        title: "Requester preferences", what: "Lets you choose which updates you receive for a request.", who: "Requesters (through the link in their emails).",
        steps: ["Open the manage-updates link at the bottom of an email.", "Choose your preferences."],
        next: "Your choices apply to that request.",
        notes: ["Your personal link is private — don’t forward it."],
        figs: [M("S55", "S55-requester-preferences-mobile.png", "Requester preferences")], layout: "mobile",
      }),
      wf({
        title: "“This link isn’t active”", what: "Shown when a requisition link has expired, reached its limit, been replaced or been revoked.", who: "Requesters.",
        steps: ["Contact the Finance team who sent you the link.", "Ask for a new link."],
        next: "Use the new link to submit your request.",
        notes: ["Nothing you typed on an inactive link is submitted."],
        figs: [M("S56", "S56-inactive-link-mobile.png", "Inactive link")], layout: "mobile",
      }),
    ],
  },
  {
    n: 13, title: "Notifications & Phone Alerts",
    intro: "Phone alerts are optional, short messages on your device. Images marked <b>Training illustration</b> are drawn guides — not screenshots — and iOS screens may look different on your phone. S12 is a <b>real capture</b> from the training environment, framed for this guide.",
    pages: [
      wf({ title: "1 · Find the Phone notifications card", what: "Starts phone alerts for this device.", who: "Any staff member.", steps: ["Open <b>Notifications</b>.", "Find <b>Phone notifications</b>.", "Tap <b>Enable phone notifications</b>."], next: "Your device asks for permission.", notes: ["On iPhone, install the app first (steps 5–7 below)."], figs: [G("S09", "S09-phone-notifications-off-graphic.png", "Phone notifications off")] }),
      wf({ title: "2 · Allow notifications", what: "Gives TKT permission to show alerts.", who: "Any staff member.", steps: ["When asked, tap <b>Allow</b>."], next: "The card switches on.", notes: ["iOS asks only the first time. Appearance may vary by iOS version.", "If you tapped Don’t Allow, turn notifications on for the app in your device settings."], figs: [G("S10", "S10-ios-notification-permission-graphic.png", "iOS permission prompt (simplified)")] }),
      wf({ title: "3 · Alerts are on", what: "Confirms this device is registered and lets you choose which alerts to receive.", who: "Any staff member.", steps: ["Check <b>On for this device.</b>", "Choose <b>Important & actionable (recommended)</b> or <b>Important only</b>.", "Remove a device from <b>Your devices</b> at any time."], next: "Alerts arrive for the events you chose.", notes: ["Everything still appears in the bell and on the Notifications page.", "Signing out does not turn alerts off on a device — remove it here."], figs: [G("S11", "S11-phone-notifications-enabled-graphic.png", "Phone notifications on")] }),
      wf({ title: "4 · Receive an alert", what: "Important workflow alerts can appear on your Lock Screen.", who: "Any staff member with alerts on.", steps: ["Read the short alert.", "Tap it to open the exact requisition in the app."], next: "The app opens on that requisition’s detail page (after you sign in if needed).", notes: ["Alerts never show amounts, items or names — details open in the app."], figs: [G("S12", "S12-lock-screen-alert-mobile.png", "Lock Screen alert", "Real capture · framed")] }),
      wf({ title: "5 · Install: tap Share", what: "Installing is required for phone alerts on iPhone.", who: "iPhone users.", steps: ["Open the platform in <b>Safari</b>.", "Tap <b>Share</b>."], next: "The Share menu opens.", notes: ["Toolbar layout may vary by iOS version and Safari settings."], figs: [G("S13", "S13-safari-share-graphic.png", "Safari Share button")] }),
      wf({ title: "6 · Install: Add to Home Screen", what: "Adds the app to your Home Screen.", who: "iPhone users.", steps: ["Choose <b>Add to Home Screen</b>.", "Tap <b>Add</b>."], next: "The app icon appears on your Home Screen.", notes: ["Menu wording or position may vary by iOS version."], figs: [G("S14", "S14-add-to-home-screen-graphic.png", "Add to Home Screen (simplified)")] }),
      wf({ title: "7 · Open from the Home Screen", what: "Use the installed app for phone alerts.", who: "iPhone users.", steps: ["Open the app from the Home Screen.", "Sign in, then return to step 1."], next: "You can now enable phone notifications.", notes: ["Requires iOS 16.4 or later."], figs: [G("S15", "S15-tkt-training-home-screen-graphic.png", "Home Screen icon")] }),
    ],
  },
  {
    n: 14, title: "Troubleshooting & FAQ",
    pages: [
      text({
        blocks: [
          { faq: [
            ["I can’t sign in.", "Check your email address and password. Use <b>Forgot your password?</b> to request a password reset and follow the instructions provided by the sign-in service. Accounts are by invitation only — ask your administrator if you have not been invited, or if your account shows as deactivated."],
            ["A menu or page is missing.", "Menus show only what your roles allow. See Section 15 and ask an administrator if you need more access."],
            ["“Phone notifications aren’t available yet.”", "Phone alerts have not been set up for this site yet. You still see everything in the bell and on the Notifications page."],
            ["On iPhone, the card says to add the app to the Home Screen first.", "Install the app (Section 4), open it from the Home Screen, sign in, then enable notifications."],
            ["“Notifications are blocked for this site.”", "Allow notifications for the app in your device or browser settings. In-app notifications keep working."],
            ["I tapped an alert — what opens?", "The exact page the alert refers to, such as the requisition. If you are signed out, sign in and you are taken there."],
            ["A requester didn’t get a confirmation email.", "The confirmation page says an email was sent only when it was actually sent. Ask the requester for the requisition number shown on screen."],
            ["The PO message says it wasn’t emailed.", "The PO was still issued. Download the PDF from the PO card and share it with the requester."],
            ["A requisition link says “This link isn’t active.”", "It has expired, reached its submission limit, been replaced or been revoked. Send the requester a new link (Section 11)."],
            ["The request form won’t submit.", "Check highlighted fields. Essential items need a reason; Reimbursements need the amount paid, vendor, purchase date and an itemized receipt; the certification must be ticked."],
          ] },
        ],
      }),
      wf({
        title: "You’re offline", what: "Shown when the device has no connection.", who: "Everyone.",
        steps: ["Reconnect to the internet.", "Return to the app and continue."],
        next: "The app loads normally once you are back online.",
        notes: ["Financial information is never stored on the device."],
        figs: [M("S57", "S57-offline-mobile.png", "Offline page")], layout: "mobile",
      }),
    ],
  },
  {
    n: 15, title: "Role Quick Reference",
    pages: [text({
      blocks: [
        { matrix: {
          head: ["Area", "Administrator", "Head of Finance", "Finance User", "Reporting User", "Viewer"],
          rows: [
            ["Dashboard", "✓", "✓", "✓", "✓", "✓ (attendance)"],
            ["Notifications & phone alerts", "✓", "✓", "✓", "✓", "✓"],
            ["Sunday entry — attendance", "✓", "", "", "✓", ""],
            ["Sunday entry — finance", "✓", "✓", "✓", "", ""],
            ["Requisitions & review", "✓", "✓", "", "", ""],
            ["Purchase Orders & vendor orders", "✓", "✓", "", "", ""],
            ["Receipts, reconciliation & disbursements", "✓", "✓", "", "", ""],
            ["Reports", "✓", "✓", "", "✓ (Attendance)", ""],
            ["Categories", "✓", "✓", "", "", ""],
            ["Departments", "✓", "", "", "", ""],
            ["Requisition links", "✓", "✓", "", "", ""],
            ["Audit log", "✓", "✓", "", "", ""],
            ["Setup, settings, users, roles, request types", "✓", "", "", "", ""],
          ],
        } },
        { p: "<b>External requesters</b> have no account and use a requisition link only (Section 12)." },
        { callout: "note", text: "If you need access you don’t have, ask an Administrator to review your roles." },
      ],
    })],
  },
  {
    n: 16, title: "Support",
    pages: [text({
      blocks: [
        { p: "For help with your account, access or a request:" },
        { support: META.support },
        { list: ["Have the requisition number (for example TKT-REQ-2026-0043) ready if your question is about a request.", "Never share passwords, requisition links or private links from emails.", "Department leads should contact the Finance team who sent their link."] },
      ],
    })],
  },
  {
    n: 17, title: "Revision History",
    pages: [text({
      blocks: [
        { table: { head: ["Version", "Date", "Changes"], rows: [["Draft 0.1", "October 2026", "First full draft from the training environment (screens S01–S57)."]] } },
        { p: "All screens use the training environment with fictional data. Screens S09–S11 and S13–S15 are training illustrations; S12 is a real capture, framed; S49 shows a simulated product lookup; S54 shows emails rendered from the real templates and never sent." },
      ],
    })],
  },
];
