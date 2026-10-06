PROJECT: THE KINGS TRIBE — CHURCH FINANCE & OPERATIONS WEB APPLICATION

You are acting as the senior full-stack engineer, solution architect, database architect, UI/UX engineer, security engineer, and technical documentation writer for this project.

Build a production-ready web application for The Kings Tribe church.

The application will initially be used by approximately 5 authorized internal users but should be architected so additional users, departments, ministries, categories, and permissions can be added later without restructuring the application.

The application must work exceptionally well on desktop and mobile and must be installable on an iPhone Home Screen as a Progressive Web App (PWA).

⸻

1. TECHNOLOGY STACK

Use:

* Next.js with App Router
* TypeScript
* React
* Tailwind CSS
* Supabase
    * PostgreSQL
    * Supabase Auth
    * Supabase Storage
    * Row Level Security
* Vercel for deployment
* React Hook Form
* Zod validation
* Recharts or another appropriate React charting library
* Server Actions/API routes where appropriate
* A reliable PDF generation library for Purchase Orders
* Resend or another Vercel-compatible transactional email provider

Do not unnecessarily over-engineer the application.

Favor maintainability, security, clear code organization, and an excellent mobile experience.

⸻

2. BRANDING

I will provide The Kings Tribe brand assets separately in the project directory.

You must inspect and use those assets.

CRITICAL BRAND RULE

DO NOT redraw, recreate, modify, distort, recolor, crop, stretch, trace, regenerate, or otherwise alter The Kings Tribe logo.

Use the supplied official logo file directly.

Maintain its original aspect ratio and clear space.

Use the supplied:

* Logo
* Colors
* Typography
* Graphic elements
* Brand guidelines

to derive the application’s visual design.

The UI should feel modern, premium, clean, minimal, and appropriate for a contemporary church organization.

Do not invent replacement branding when official assets are available.

Create reusable design tokens for the brand colors and typography.

⸻

3. APPLICATION ARCHITECTURE

There are TWO fundamentally different user experiences.

A. INTERNAL APPLICATION

Only authenticated authorized church users can access:

* Dashboard
* Sunday Entry
* Attendance
* Finance
* Requisitions
* Purchase Orders
* Receipt Reconciliation
* Reports
* Categories
* Departments
* User Administration
* Settings

Initially support approximately 5 users.

B. EXTERNAL REQUISITION FORM

Department/ministry leads DO NOT receive accounts and DO NOT have access to the internal application.

Instead, they receive a secure link to a requisition form.

Example:

/request/[secure-token]

Do not expose sequential IDs or sensitive database information through the URL.

Department leads should only be able to submit requests and receive subsequent updates through email/SMS where configured.

They must never be able to browse:

* Church finances
* Attendance
* Other requisitions
* Dashboards
* Other departments’ information
* Purchase Orders belonging to other requests
* Administrative information

Enforce this at the DATABASE/API level, not merely by hiding UI components.

⸻

4. AUTHENTICATION AND ROLES

Implement Supabase authentication.

Create role-based access control.

Initial roles:

Administrator

Full system administration.

Head of Finance

Can:

* View financial information
* View attendance
* Manage requisitions
* Approve/Hold/Reject requisitions
* Partially approve requisitions
* Issue Purchase Orders
* Record purchases
* Reconcile receipts
* Manage financial categories
* Run reports

Finance User

Can enter Sunday financial data and access explicitly granted finance functionality.

Reporting User

Can enter attendance/reporting data according to permissions.

Viewer

Read-only access to explicitly permitted internal dashboards.

Build the authorization architecture so permissions can become more granular later.

Use Supabase Row Level Security.

Never trust authorization decisions made only by the frontend.

⸻

5. MAIN NAVIGATION

Create a responsive application shell.

Desktop:

* Sidebar navigation

Mobile:

* Appropriate mobile navigation

Primary sections:

* Dashboard
* Sunday Entry
* Requisitions
* Purchase Orders
* Reports
* Categories
* Departments
* Administration / Settings

Display navigation according to user permissions.

⸻

6. MAIN DASHBOARD

Build a polished executive dashboard.

At minimum show:

Latest Sunday

* Total Attendance
* Adult Attendance
* Children’s Attendance
* Total Finance Received
* Tithe
* Offering
* Church Outreach
* Custom financial categories

Display comparisons such as:

* Previous Sunday
* 4-week trend
* Month-to-date
* Year-to-date where meaningful

Use appropriate charts for:

* Attendance trend
* Adult vs Children’s attendance
* Weekly giving trend
* Giving by category
* Month-to-date giving
* Requisition spending
* Requisition status

Allow date filtering.

The most important church metrics should be immediately visible.

⸻

7. SUNDAY ENTRY

Create a dedicated Sunday Entry workflow.

A user chooses or confirms the Sunday/service date.

The page contains two primary buckets:

ATTENDANCE

Default categories:

* Adult Church
* Children’s Church

Users enter numerical attendance counts.

Automatically calculate:

Total Attendance = Sum of active attendance categories

Administrators must be able to add additional attendance categories.

Examples:

* Youth
* Volunteers
* Guests
* Special Service

Do not permanently hard-code Adult and Children as the only categories.

⸻

8. FINANCE RECEIVED

The second Sunday Entry bucket is:

FINANCE

Default categories:

* Offering
* Tithe
* Church Outreach

Allow authorized administrators to create additional categories and subcategories without modifying code.

Each entry captures:

* Sunday/service date
* Category
* Subcategory where applicable
* Amount
* Entered by
* Created timestamp
* Updated timestamp
* Optional notes

Automatically calculate:

Total Finance Received

Format currency properly.

Prevent invalid negative values unless an administrator explicitly creates a transaction type that permits adjustments.

Maintain an audit trail of financial record changes.

⸻

9. CATEGORY MANAGEMENT

Do not hard-code categories.

Support category types such as:

* Attendance
* Finance
* Requisition
* Accounting/Budget

Administrators can:

* Create
* Rename
* Deactivate
* Reorder

categories and subcategories.

Do not delete historical categories referenced by existing transactions.

Use inactive/archive status.

⸻

10. DEPARTMENT MANAGEMENT

Create configurable departments and subcategories.

Initial departments:

Production Team

Subcategories:

* Audio Production
* Video Production
* Live Sound

Hospitality Team

Initial subcategories:

* Guest Experience
* Welcome & Greeters
* Refreshments & Hospitality
* Events & Fellowship
* Facility Presentation
* Supplies & Consumables

Children’s Ministry Team

Initial subcategories:

* Curriculum & Teaching Materials
* Classroom Supplies
* Arts & Crafts
* Children’s Worship
* Snacks & Refreshments
* Safety & Check-In
* Events & Activities
* Furniture & Equipment

These are initial database values, NOT permanent hard-coded limitations.

Administrators must be able to create departments and subcategories.

When a department is selected on the requisition form, dynamically populate only that department’s subcategories.

⸻

11. EXTERNAL REQUISITION FORM

Build a polished, mobile-first requisition form accessed through a secure external link.

Department leads should not need to sign into the main application.

CHURCH INFORMATION

Display centrally configured:

* Church Name
* Address
* Phone
* Email

Do not hard-code church information throughout the application.

REQUESTER / DEPARTMENT

Capture:

* Requester’s full name
* Requester’s email
* Requester’s phone
* Department
* Subcategory
* Department head/requester name
* Date submitted — automatically generated
* Date items/funds are needed

Validate email and phone inputs.

⸻

12. REQUEST TYPE

Provide the following request types:

* Order
* Direct Purchase / Purchase Order
* Reimbursement
* Petty Cash
* Advance Check

Make Order the default request type.

The database and workflow engine must support different required fields, validation rules, approval requirements, and post-approval actions depending on request type.

ORDER

Order means the requesting department is asking the church/Finance team to purchase the requested items on the department’s behalf.

Workflow:

Department Request → Finance Review → Approval → PO/Order Authorization → Church Purchases Items → Receipt/Invoice → Reconciliation → Purchased → Closed

For an Order:

1. Department lead submits requisition.
2. Finance reviews request.
3. Finance can Approve, Partially Approve, Hold, or Reject.
4. Approved line items become eligible for purchasing.
5. Generate appropriate PO/order documentation.
6. Authorized church user records the purchase.
7. Receipts/invoices are attached.
8. Finance reconciles purchases against approved lines.
9. Support partial purchases.
10. Support multiple orders and receipts.
11. Once all approved items are accounted for, mark Purchased.
12. Finance can subsequently mark the request Closed.

DIRECT PURCHASE / PURCHASE ORDER

Use when the department/requester will make an approved purchase using a church-issued Purchase Order or authorization.

Finance must approve before the PO is issued.

REIMBURSEMENT

Use when an eligible purchase has already been made and the requester is asking to be reimbursed.

Require:

* Actual purchase amount
* Vendor
* Purchase date
* Receipt upload

Do not treat Reimbursement as the same workflow as Order.

PETTY CASH

Use for small approved cash expenses according to church policy.

ADVANCE CHECK

Use when approved funds/check are required before an expense occurs.

Design the request-type architecture so additional types can be added later.

⸻

13. FINANCIAL CODING

Include:

Budget Line / Cost Center

Allow selection from configured cost centers/budget lines.

Budget Status

Ask:

Is this purchase within your approved ministry budget?

Options:

* Yes
* No
* Unsure

If No or Unsure, reveal an explanation field.

⸻

14. ITEMIZED REQUEST

A requisition can contain MULTIPLE line items.

Each line should include:

* Item description
* Specifications
* Color
* Size
* Quantity
* Estimated unit price
* Calculated estimated total
* Vendor name
* Vendor website/product URL
* Optional notes

Color and size are optional.

Provide a prominent:

+ Add Item

button.

Users can add multiple line items.

Allow removal before submission.

Automatically calculate:

Line Total = Quantity × Estimated Unit Price

and:

Estimated Requisition Total = Sum of all line totals

Never trust browser calculations alone.

Recalculate monetary totals server-side.

Use proper PostgreSQL decimal/numeric types for money.

Do not use floating-point arithmetic for authoritative financial calculations.

⸻

15. PURPOSE / JUSTIFICATION

Provide:

Purpose / Ministry Justification

Prompt:

“Describe how these items or funds will support your ministry or church activity.”

Require an appropriate explanation.

⸻

16. REQUESTER CERTIFICATION

Include a certification checkbox such as:

“I certify that the information provided in this request is accurate and that the requested purchase is for authorized church/ministry purposes.”

Capture:

* Requester name
* Certification
* Date/time

Do not represent this as a legally binding electronic signature unless a compliant e-signature system is actually implemented.

⸻

17. REQUISITION SUBMISSION

Upon submission:

1. Validate everything server-side.
2. Generate unique requisition number.

Example:

TKT-REQ-2026-0001

Generate sequences safely to prevent duplicate numbers.

3. Store requisition.
4. Store line items.
5. Set status to Submitted.
6. Record action in audit log.
7. Notify Head of Finance.
8. Send requester confirmation.

Confirmation should include:

* Requisition number
* Department
* Submitted date
* Date needed
* Request type
* Item summary
* Estimated total
* Current status

⸻

18. REQUISITION ADMINISTRATION

Inside the authenticated application create a Requisitions page.

Display searchable/filterable table.

Columns:

* Requisition #
* Date
* Requester
* Department
* Subcategory
* Request Type
* Date Needed
* Estimated Total
* Status
* Assigned Reviewer

Filters:

* Status
* Department
* Date
* Requester
* Request Type

Provide search.

Selecting a requisition opens the complete request.

⸻

19. REQUISITION WORKFLOW

Statuses must include at minimum:

* Submitted
* Under Review
* On Hold
* Approved
* Partially Approved
* Rejected
* PO Issued
* Ordered
* Partially Purchased
* Purchased
* Closed

Implement controlled workflow transitions.

Maintain complete status history:

* Previous status
* New status
* Changed by
* Date/time
* Comments

⸻

20. FINANCE REVIEW

Head of Finance can:

* APPROVE
* PARTIALLY APPROVE
* HOLD
* REJECT

Each line item can individually be:

* Approved
* Held
* Rejected

Require comments when rejecting or holding.

Store reviewer comments.

Notify requester when material status changes occur.

⸻

21. PURCHASE ORDER

When an eligible requisition is approved, allow Finance to generate a Purchase Order.

Generate unique PO number:

TKT-PO-2026-0001

PO number and Requisition number are separate identifiers.

Generate a professionally formatted PDF Purchase Order.

Use The Kings Tribe branding without modifying the official logo.

Include:

* Official logo
* Church name
* Church address
* Church phone
* Church email
* PO number
* Requisition number
* Issue date
* Department
* Requester
* Vendor information
* Approved items
* Quantity
* Unit price
* Line totals
* PO total
* Financial coding
* Approval information
* Notes
* Policy/footer

Provide:

Download PDF

Store generated PDF securely.

⸻

22. PO EMAIL

When PO is generated, email requester.

Include:

* PO number
* Requisition number
* Approved amount
* Approved items
* Instructions
* PDF attachment or secure download link

Clearly instruct requester to retain itemized receipts.

⸻

23. RECORDING ORDERS AND PURCHASES

For Order requests, create functionality allowing authorized users to record that approved items have been ordered.

Capture:

* Order date
* Vendor
* Vendor order/reference number
* Items ordered
* Quantities
* Actual or expected price
* Expected delivery date where available
* Notes

A single requisition may result in multiple vendor orders.

Do not assume one requisition equals one vendor order.

Support partial ordering.

⸻

24. RECEIPT WORKFLOW

Implement TWO receipt paths.

METHOD A — APPLICATION UPLOAD

Authorized internal users can upload receipts.

Support:

* PDF
* JPEG
* PNG
* HEIC where practical

Store securely in Supabase Storage.

Receipt bucket must NOT be public.

Validate:

* MIME type
* Extension
* Maximum file size

Use signed URLs or authenticated access.

⸻

25. EMAIL RECEIPT WORKFLOW

Requester should be able to reply to PO/order email with receipt attachments.

Implement an inbound-email/webhook architecture.

Attempt to identify:

* Requisition number
* PO number

using:

* Email subject
* Reply metadata
* Message content
* Deterministic reply token/plus-address where possible

Do not rely solely on free-text parsing.

When matched:

1. Attach email/receipt to correct requisition/PO.
2. Create receipt record.
3. Queue for Finance reconciliation.

IMPORTANT:

Do not automatically assume every item was purchased merely because a receipt arrived.

Provide reconciliation.

Support:

* Full purchase
* Partial purchase
* Multiple receipts
* Multiple purchases
* Partial quantities
* Actual price different from approved price

Finance confirms reconciliation.

Then mark relevant quantities/lines purchased.

Automatically derive status:

* PO Issued
* Ordered
* Partially Purchased
* Purchased

Maintain audit history.

⸻

26. RECEIPT RECONCILIATION

Create reconciliation screen comparing:

PO / APPROVED INFORMATION

versus

ACTUAL PURCHASE / RECEIPT

For each line show:

* Ordered quantity
* Approved amount
* Purchased quantity
* Actual amount
* Remaining quantity
* Variance

Allow Finance to match receipts to individual PO lines.

Store:

* Actual quantity
* Actual cost
* Purchase date
* Vendor
* Receipt reference

Support multiple receipts per PO.

⸻

27. EMAIL NOTIFICATIONS

Implement transactional emails for:

* Requisition submitted
* Finance receives new requisition
* Under Review
* On Hold
* Approved
* Partially Approved
* Rejected
* PO Issued
* Order placed
* Receipt received
* Receipt reconciliation completed
* Purchase completed
* Request closed

Avoid unnecessary email.

Create reusable branded email templates.

⸻

28. SMS / PHONE UPDATES

Requester enters phone number for status updates.

Architect SMS behind a provider abstraction.

If SMS requires Twilio or another provider, do not fake functionality.

Allow opt-in/out.

Email remains primary initially.

⸻

29. REPORTING

Provide reporting for:

Attendance

* Weekly
* Monthly
* Quarterly
* Year-to-date
* Adult
* Children
* Total
* Custom categories

Finance

* Weekly giving
* Monthly giving
* YTD giving
* Giving by category
* Trends

Requisitions / Purchasing

* Requests by department
* Requests by request type
* Requested amount
* Approved amount
* Actual purchased amount
* Approved vs rejected
* Open requests
* Outstanding receipts
* Orders awaiting purchase
* Spending by department
* Spending by category
* Estimated vs actual cost
* Purchase variance

Allow date ranges.

Provide CSV export where appropriate.

⸻

30. DATA MODEL

Design a normalized PostgreSQL schema.

Evaluate tables/entities for:

* profiles
* roles
* permissions
* user_roles
* departments
* department_subcategories
* attendance_categories
* attendance_entries
* finance_categories
* finance_entries
* service_dates
* requisitions
* requisition_items
* requisition_status_history
* requisition_comments
* request_types
* cost_centers
* purchase_orders
* purchase_order_items
* vendor_orders
* vendor_order_items
* receipts
* receipt_files
* receipt_item_allocations
* organizations/church_settings
* notification_preferences
* notifications
* audit_logs
* external_form_tokens

Use:

* UUID primary keys internally
* Human-readable requisition/PO numbers separately
* Foreign keys
* Indexes
* Constraints
* Timestamps
* Appropriate numeric types
* Enums or lookup tables where appropriate

Include migrations.

Include seed data.

⸻

31. AUDIT LOGGING

Audit sensitive actions:

* Sunday finance created
* Finance edited
* Finance voided/deleted
* Attendance changed
* Requisition submitted
* Status changed
* Approval
* Rejection
* PO generated
* Order recorded
* Receipt uploaded
* Receipt reconciled
* Purchase completed
* Categories changed
* Permissions changed

Capture:

* Actor
* Action
* Entity type
* Entity ID
* Timestamp
* Meaningful before/after metadata

Ordinary users cannot edit audit records.

⸻

32. SECURITY

Treat financial information as sensitive.

Implement:

* Supabase RLS
* Server-side authorization
* Secure environment variables
* Secure external-form tokens
* Input validation
* Output encoding
* Rate limiting
* Anti-spam protection
* Safe file validation
* Private Storage
* Signed URLs
* Webhook signature validation
* Least-privilege access
* IDOR protection
* CSRF protection where applicable
* XSS protection
* SQL injection prevention
* Safe redirects

Never expose:

* Supabase service-role key
* Email API secrets
* Webhook secrets
* Database credentials

to browser JavaScript.

Provide .env.example.

Never commit secrets.

⸻

33. PWA / IPHONE HOME SCREEN

Configure as an installable PWA.

Include:

* Web app manifest
* Application name
* Short name
* Brand theme color
* Background color
* Appropriate icons
* Apple touch icon
* Standalone display
* Responsive viewport
* iPhone safe-area support
* Mobile navigation

Do not alter the official church logo for the icon.

If an approved icon/mark exists, use it.

Otherwise place the unaltered official logo appropriately within the app-icon canvas.

⸻

34. MOBILE UX

Design mobile-first.

Ensure:

* Large touch targets
* Readable fields
* Correct iOS keyboards
* Numeric input for currency/quantity
* Email keyboard
* Telephone keyboard
* No horizontal scrolling
* Easy + Add Item
* Clear sections
* Loading states
* Validation messages
* Submission confirmation

⸻

35. APPLICATION SETTINGS

Provide configurable:

* Church information
* Finance categories
* Attendance categories
* Departments
* Department subcategories
* Request types
* Cost centers
* Notification settings
* Requisition policy
* PO policy/footer
* Currency
* Timezone

⸻

36. REQUISITION POLICY

Make policy text configurable.

Initial example:

“Submit purchase requests 3–7 days before funds/items are needed whenever practical. Itemized receipts must be submitted for completed purchases.”

Do not hard-code this throughout the application.

⸻

37. TESTING

Test critical logic:

* Financial calculations
* Attendance totals
* Requisition totals
* Permission checks
* Secure external tokens
* Requisition submission
* Request-type-specific validation
* PO generation
* Partial approval
* Order recording
* Partial ordering
* Receipt reconciliation
* Status transitions

Test critical API/server actions.

⸻

38. DEMO / SEED DATA

Provide clearly labeled fictional/demo data for:

* Several Sundays
* Attendance
* Finance
* Requisitions
* Request types
* Requisition statuses
* Departments
* Orders

Demo data must be identifiable and removable.

⸻

39. DEVELOPMENT PHASES

Implement in this order:

Phase 1 — Foundation

* Next.js
* Styling
* Brand system
* Supabase
* Authentication
* Database
* RLS
* Application shell

Phase 2 — Sunday Reporting

* Attendance
* Finance
* Categories
* Dashboard

Phase 3 — Requisitions

* Public form
* Secure links
* Departments
* Dynamic subcategories
* Request types
* Line items
* Submission
* Review workflow

Phase 4 — Purchasing

* Approval
* Partial approval
* Purchase Orders
* PDF generation
* Order recording
* Emails

Phase 5 — Receipts

* Uploads
* Inbound email
* Reconciliation
* Partial purchases
* Completion

Phase 6 — Reporting & PWA

* Reports
* Exports
* iPhone PWA
* Settings
* UI polish

Phase 7 — Security / Testing / Deployment

* Security review
* Tests
* Production configuration
* Vercel deployment

Do not leave phases as pseudocode.

Implement them.

⸻

40. SETUP WIZARD

Provide an initial setup experience where practical.

First Administrator configures:

* Church information
* Initial administrator
* Categories
* Departments
* Notification email
* Requisition policy

Do not sacrifice security for convenience.

⸻

41. README AND BEGINNER SETUP GUIDE

Create:

README.md

and:

SETUP-GUIDE.md

The setup guide must assume I am a beginner.

Do not say:

“Configure Supabase.”

Instead tell me exactly what to click.

⸻

42. SUPABASE CLICK-BY-CLICK GUIDE

Provide explicit instructions:

1. Open Supabase.
2. Click New project.
3. Select organization.
4. Enter project name.
5. Generate/store database password.
6. Select region.
7. Click Create new project.

Then explain where to obtain:

* Project URL
* Publishable/anon key
* Service-role/server key when required

Explain exactly where each value goes.

Never expose server credentials to the browser.

⸻

43. DATABASE SETUP GUIDE

Explain exactly how to:

* Run migrations
* Verify tables
* Verify RLS
* Create Storage buckets
* Verify policies
* Load seed data

Provide exact terminal commands.

Explain where commands are run and expected results.

For SQL Editor steps use instructions such as:

1. Click SQL Editor.
2. Click New Query.
3. Paste the specified SQL.
4. Click Run.
5. Confirm the expected result.

⸻

44. AUTH SETUP GUIDE

Explain:

* Supabase Auth
* Redirect URLs
* Localhost URLs
* Vercel production URL
* First administrator
* Inviting remaining users
* Assigning roles

Explicitly explain how all 5 internal users are added.

⸻

45. EMAIL SETUP GUIDE

Provide click-by-click setup for the chosen transactional email provider.

If using Resend explain:

* Account creation
* Domain verification
* DNS
* API key
* Environment variable
* Sender address
* Testing

Explain inbound receipt-email processing separately.

If another service is required, explain why and provide exact setup.

⸻

46. VERCEL DEPLOYMENT GUIDE

Provide explicit instructions:

1. GitHub setup if required.
2. Push repository.
3. Open Vercel.
4. Add New Project.
5. Import repository.
6. Configure framework.
7. Add environment variables.
8. Deploy.
9. Find production URL.
10. Add production URL to Supabase redirects.
11. Redeploy if required.
12. Test login.
13. Test Sunday Entry.
14. Test requisition.
15. Test approval.
16. Test PO.
17. Test order.
18. Test receipt upload.

List every environment variable.

For each variable identify:

* Browser-safe
* Server-only
* Secret

⸻

47. CUSTOM DOMAIN

Provide optional instructions for connecting a church subdomain such as:

operations.churchdomain.com

or

app.churchdomain.com

Do not assume the main church website should be changed.

Explain DNS configuration click-by-click.

⸻

48. IPHONE INSTALLATION GUIDE

Provide exact instructions:

1. Open production URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Confirm app name.
5. Tap Add.
6. Launch from Home Screen.

Provide PWA troubleshooting.

⸻

49. REQUISITION DETAIL PAGE

Create a clear workflow timeline.

Example:

Submitted
↓
Under Review
↓
Approved
↓
PO Issued
↓
Ordered
↓
Receipt Received
↓
Purchased
↓
Closed

Display:

* Requester
* Department
* Request type
* Justification
* Line items
* Budget
* Attachments
* Approvals
* PO
* Vendor orders
* Receipts
* Comments
* Status history
* Audit history

Actions should depend on current status and permissions.

⸻

50. FUTURE-PROOFING

Architect so the system could later support:

* Additional campuses
* Additional services
* More ministries
* Department budgets
* Expense tracking
* Bank reconciliation
* Contribution integrations
* Accounting integrations
* Vendor management
* Recurring purchases
* Inventory/assets
* Equipment tracking

DO NOT build all of these now.

Avoid architecture that blocks them later.

⸻

51. FINAL ACCEPTANCE CHECKLIST

Before declaring the project complete, verify:

Authentication

* Unauthorized users cannot access internal routes.
* Roles work.
* RLS works.

Sunday Entry

* Attendance saves.
* Finance saves.
* Totals calculate.
* Categories can be added.

Dashboard

* Correct figures displayed.
* Filters work.
* Charts work.

Requisition

* External form requires no internal account.
* Secure link works.
* Department/subcategory dependency works.
* Order is available and default.
* Multiple items work.
* Totals work.
* Requisition number generated.
* Finance notification works.

Workflow

* Approve works.
* Partial Approval works.
* Hold works.
* Reject works.
* Status history works.

Purchase Order

* PO number generated.
* PDF generated.
* Branding correct.
* Official logo unaltered.
* PDF downloadable.
* PO email works.

Orders

* Order can be recorded.
* Multiple vendor orders supported.
* Partial ordering supported.
* Quantities tracked.

Receipts

* Upload works.
* Storage remains private.
* Multiple receipts work.
* Receipt reconciliation works.
* Partial purchase works.
* Actual cost tracked.
* Final Purchased status works.

Mobile

* External form works on iPhone.
* Dashboard works on iPhone.
* PWA installs.
* Standalone mode works.

Security

* RLS tested.
* External users cannot access internal data.
* Server secrets remain server-only.
* Storage is private.
* Webhooks validate signatures.

⸻

52. IMPORTANT ENGINEERING RULES

Do NOT:

* Put financial security only in frontend code
* Make receipt Storage public
* Expose service-role credentials
* Use JavaScript floating-point arithmetic for authoritative currency
* Hard-code configurable categories
* Use sequential database IDs in public URLs
* Automatically mark an entire PO purchased merely because a receipt arrives
* Give department leads internal application access
* Alter the official church logo
* Fake integrations
* Leave critical features as TODO comments
* Claim functionality works without testing

Use database transactions for atomic operations.

Use idempotency for webhooks.

Use database constraints plus application validation.

⸻

53. WHAT I EXPECT FROM YOU

First inspect:

1. Repository
2. Brand assets
3. Brand guidelines
4. Existing project files

Then tell me:

1. What assets you found
2. Proposed architecture
3. Database design
4. Major security decisions
5. Implementation phases

Then begin implementation.

Do not require me to approve every individual file.

Continue through the build logically.

Stop and ask me only when you genuinely require:

* Credentials
* External account/API decisions
* Missing brand information
* Irreversible production decisions

Otherwise make sensible engineering decisions and continue.

After implementation:

1. Run linting.
2. Run type checking.
3. Run tests.
4. Build production application.
5. Fix errors.
6. Perform acceptance checklist.
7. Create README.md.
8. Create SETUP-GUIDE.md.
9. Clearly identify every manual action I need to perform.

The final application must be deployable using Vercel + Supabase, work well on desktop and iPhone, and install on the iPhone Home Screen as a polished PWA.
