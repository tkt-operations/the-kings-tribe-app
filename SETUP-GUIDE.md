# Setup Guide — The Kings Tribe Finance & Operations

This guide assumes **no technical background**. Follow the sections in order. Every step says exactly what to click or type.

> **About screen names.** Supabase, Vercel and Resend occasionally rename menu items. If a button isn't exactly where described, look for the closest match on the same page. The words in **bold** are what to look for.

**Time needed:** about 2–3 hours the first time, including waiting for email domain verification.

---

## Contents
1. [What you will need](#1-what-you-will-need)
2. [Prepare your computer](#2-prepare-your-computer)
3. [Create the Supabase project](#3-create-the-supabase-project)
4. [Put the Supabase keys in place](#4-put-the-supabase-keys-in-place)
5. [Set up the database](#5-set-up-the-database)
6. [Set up sign-in (Supabase Auth)](#6-set-up-sign-in-supabase-auth)
7. [Set up email (Resend)](#7-set-up-email-resend)
8. [Set up receipt emails (inbound)](#8-set-up-receipt-emails-inbound)
9. [Deploy to Vercel](#9-deploy-to-vercel)
10. [Create the first Administrator and add your team](#10-create-the-first-administrator-and-add-your-team)
11. [Optional: your own web address (custom domain)](#11-optional-your-own-web-address-custom-domain)
12. [Install on iPhone](#12-install-on-iphone)
13. [Final acceptance test](#13-final-acceptance-test)
14. [Optional: SMS text updates (Twilio)](#14-optional-sms-text-updates-twilio)
15. [Everyday tasks & troubleshooting](#15-everyday-tasks--troubleshooting)
16. [Every environment variable](#16-every-environment-variable)

---

## 1. What you will need

| Account | Why | Cost |
|---|---|---|
| **GitHub** (github.com) | Stores the code privately so Vercel can deploy it | Free |
| **Supabase** (supabase.com) | Database, sign-in, private file storage | Free tier is enough to start |
| **Vercel** (vercel.com) | Hosts the website | Free "Hobby" tier is enough to start |
| **Resend** (resend.com) | Sends emails and receives receipt replies | Free tier: 3,000 emails/month |
| A domain you control (e.g. `yourchurch.org`) | Needed to send email from your church's address | You likely have one |
| *(Optional)* **Twilio** | Text-message updates | Pay as you go |

Keep a **password manager** (or a secure note) open. You will create several secrets.

> **Keep the GitHub repository PRIVATE.** It contains the Satoshi font files, which their license does not allow to be shared publicly, and your church's configuration.

---

## 2. Prepare your computer

You only need this to load the database and to run the app on your own computer. These steps are for a Mac.

1. **Install Node.js.**
   1. Go to **https://nodejs.org**.
   2. Download the **LTS** version (22 or newer) and run the installer.
2. **Open Terminal.** Press **⌘ + Space**, type **Terminal**, then press **Return**.
3. **Check the tools.** Type each line and press **Return**:
   ```bash
   node -v
   git --version
   ```
   - **Expected:** `node` prints `v22.x.x` or newer, and `git` prints a version number.
   - If `git` asks to install **Command Line Tools**, click **Install** and wait.
4. **Go to the project folder:**
   ```bash
   cd ~/the-kings-tribe-app
   ```
   (Use the folder where the project lives.)
5. **Install the app's dependencies:**
   ```bash
   npm install
   ```
   - **Expected:** it finishes with "added … packages". Warnings are fine.
6. **Create your private settings file:**
   ```bash
   cp .env.example .env.local
   ```
   - Open it in TextEdit: `open -a TextEdit .env.local`
   - You will fill it in during the next sections.
   - **Never share this file or upload it anywhere.**

---

## 3. Create the Supabase project

1. **Open Supabase.** Go to **https://supabase.com/dashboard** and sign in (or **Sign up**).
2. **Click New project.**
3. **Select organization.** Choose your organization, or create one named e.g. "The Kings Tribe".
4. **Enter project name:** `kings-tribe-operations`.
5. **Generate and store the database password.**
   1. Click **Generate a password**.
   2. **Copy it into your password manager now.** You need it in Section 5.
6. **Select region.** Pick the region closest to your church, e.g. **East US (North Virginia)** for the eastern United States.
7. **Click Create new project.** Wait 1–2 minutes until the dashboard shows the project as ready.

---

## 4. Put the Supabase keys in place

Each value below goes into `.env.local` now, and into Vercel later (Section 9).

| What | Where to find it in Supabase | Where it goes | Safe for the browser? |
|---|---|---|---|
| **Project URL** | Click **Connect** at the top of the project, or **Project Settings → Data API**. It looks like `https://abcdefgh.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL=` | ✅ Yes |
| **Publishable key** (`sb_publishable_…`), or **anon public** key on older projects | **Project Settings → API Keys** | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` | ✅ Yes (protected by Row Level Security) |
| **Secret key** (`sb_secret_…`), or **service_role** key on older projects | **Project Settings → API Keys → Secret keys** (click **Reveal**) | `SUPABASE_SECRET_KEY=` | ❌ **Never.** Server only. It bypasses all security rules. |
| **Project reference** | The `abcdefgh` part of the Project URL | Used in Section 5 | — |

Also set these in `.env.local`:

- `NEXT_PUBLIC_APP_URL=http://localhost:3000` (you will change it for production).
- `SETUP_TOKEN=`, a long random secret.
  1. In Terminal run:
     ```bash
     openssl rand -base64 32
     ```
  2. Copy the output after `SETUP_TOKEN=`.
  3. Save it in your password manager too.

Save the file.

---

## 5. Set up the database

All of this is done once. The database structure, security rules, storage buckets and starting categories are all created by the **migrations** in `supabase/migrations/`.

### 5.1 Run the migrations (recommended: the Supabase command-line tool)
Run these in **Terminal**, inside the project folder:

1. **Sign the tool in to Supabase:**
   ```bash
   npx supabase login
   ```
   - A browser window opens. Click **Authorize**.
   - **Expected:** "You are now logged in."
2. **Connect this folder to your project.** Replace `YOUR_PROJECT_REF` with the reference from Section 4:
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```
   - When asked for the **database password**, paste the one you saved in Section 3.
   - **Expected:** "Finished supabase link."
3. **Apply the migrations:**
   ```bash
   npx supabase db push
   ```
   - It lists 9 migrations (`20261005000100_foundation.sql` … `20261005000900_admin_role_guard.sql`) and asks **"Do you want to push these migrations?"**. Type **Y** and press Return.
   - **Expected:** each file shows "Applying migration …", ending with **"Finished supabase db push."**

<details>
<summary><strong>Alternative without the command-line tool</strong> (SQL Editor)</summary>

For **each** file in `supabase/migrations/`, **in filename order**:

1. In Supabase, click **SQL Editor** (left menu).
2. Click **New query**.
3. Open the migration file in TextEdit, select all, copy, and paste it into the editor.
4. Click **Run**.
5. Confirm the result says **"Success. No rows returned"**.

Do not skip or reorder files.
</details>

### 5.2 Verify the tables
1. Click **SQL Editor → New query**.
2. Paste:
   ```sql
   select count(*) as tables from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE';
   ```
3. Click **Run**.
4. **Expected:** `tables = 33`.

You can also click **Table Editor**. You should see tables such as `requisitions`, `finance_entries` and `church_settings`.

### 5.3 Verify Row Level Security (RLS) is on everywhere
1. In a new query, paste:
   ```sql
   select count(*) filter (where rowsecurity) as protected,
          count(*) filter (where not rowsecurity) as unprotected
   from pg_tables where schemaname = 'public';
   ```
2. Click **Run**.
3. **Expected:** `protected = 33`, `unprotected = 0`.

### 5.4 Verify the private Storage buckets
1. In a new query, paste:
   ```sql
   select id, public, file_size_limit from storage.buckets order by id;
   ```
2. Click **Run**.
3. **Expected:** two rows, `purchase-orders` and `receipts`, both with **`public = false`** and `file_size_limit = 10485760` (10 MB).

You can also click **Storage** in the left menu. Both buckets show without a "Public" badge. The migrations created them, so **do not create buckets by hand**.

### 5.5 Verify the security policies
1. In a new query, paste:
   ```sql
   select schemaname, count(*) from pg_policies
   where schemaname in ('public', 'storage') group by schemaname order by 1;
   ```
2. Click **Run**.
3. **Expected:** `public 51` and `storage` **4 or more**. Supabase may add its own storage policies.

### 5.6 Load demo data (optional, recommended for training)
Demo data is **fictional**, labelled "DEMO", and fully removable. It needs the first Administrator to exist, so **do this after Section 10**.

1. **SQL Editor → New query.**
2. Paste the entire contents of `supabase/demo/load_demo_data.sql`.
3. Click **Run**.
4. **Expected:** "Success". In the app, Requisitions now shows 11 DEMO requests and the dashboard shows 12 Sundays.

**To remove the demo data later:** paste `supabase/demo/remove_demo_data.sql` into a new query and click **Run**.

---

## 6. Set up sign-in (Supabase Auth)

Only the ~5 internal staff have accounts. Department leads never sign in; they use a requisition link.

### 6.1 Turn off public sign-ups
1. In Supabase, click **Authentication → Sign In / Providers** (or **Providers**).
2. Turn **off** **Allow new users to sign up**. Accounts are created only by invitation.
3. Keep **Email** enabled.
4. Click **Save**.

### 6.2 Website addresses (redirect URLs)
1. Click **Authentication → URL Configuration**.
2. **Site URL:**
   - For now, use `http://localhost:3000`.
   - After deploying (Section 9), change it to your production address, e.g. `https://kings-tribe-operations.vercel.app` or `https://operations.yourchurch.org`.
3. Under **Redirect URLs**, click **Add URL** and add each of these:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR-PRODUCTION-ADDRESS/auth/callback` (add this after Section 9)
4. Click **Save**.

### 6.3 Make invitation and password-reset links work on any device
1. Click **Authentication → Emails** (or **Email Templates**).
2. Edit **Invite user**. Replace the link line with:
   ```html
   <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/auth/update-password">Accept your invitation</a></p>
   ```
   Click **Save**.
3. Edit **Reset password** (sometimes "Reset Password"). Replace the link line with:
   ```html
   <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/auth/update-password">Choose a new password</a></p>
   ```
   Click **Save**.

### 6.4 Send sign-in emails through Resend (do this after Section 7)
Supabase's built-in email service only delivers to a few addresses per hour and is meant for testing. Point it at Resend:

1. Click **Authentication → Emails → SMTP Settings** (or **Project Settings → Authentication → SMTP**).
2. Turn on **Enable Custom SMTP** and fill in:
   - **Sender email:** your verified address, e.g. `finance@yourchurch.org`
   - **Sender name:** `The Kings Tribe`
   - **Host:** `smtp.resend.com`
   - **Port:** `465`
   - **Username:** `resend`
   - **Password:** your Resend API key from Section 7.4
3. Click **Save**.

---

## 7. Set up email (Resend)

### 7.1 Create the account
1. Go to **https://resend.com** and click **Sign up**.
2. Confirm your email.

### 7.2 Add and verify your domain
1. In Resend, click **Domains → Add Domain**.
2. Enter a subdomain just for app email, e.g. `mail.yourchurch.org`. Using a subdomain keeps your main church email untouched.
3. Choose the region nearest you and click **Add**.
4. Resend shows **DNS records** (usually one **MX**, one or two **TXT** for SPF, and a **TXT** for DKIM). Keep the page open.

### 7.3 Add the DNS records where your domain is managed
Your domain is managed wherever you bought it or where your website's DNS lives: GoDaddy, Namecheap, Cloudflare, Squarespace, Google Domains/Squarespace and so on.

1. Sign in there and open **DNS** (sometimes "DNS Management", "Advanced DNS" or "Manage DNS") for `yourchurch.org`.
2. For **each** record Resend shows:
   1. Click **Add record**.
   2. Choose the same **Type** (MX or TXT).
   3. Copy the **Name/Host** exactly. Some providers want only `send.mail`, not the full domain; if the provider adds your domain automatically, leave it off.
   4. Copy the **Value/Content** exactly.
   5. For MX, use the **Priority** shown.
   6. Click **Save**.
3. Back in Resend, click **Verify DNS Records**.
4. Verification can take from a few minutes to several hours. Wait until the domain shows **Verified**.

### 7.4 Create the API key
1. In Resend, click **API Keys → Create API Key**.
2. **Name:** `kings-tribe-app`. **Permission:** **Sending access** is enough for sending (the app also uses it to read received emails, so choose **Full access** if receipts by email are wanted).
3. Click **Add** and **copy the key immediately**. It is shown once.
4. Put it in `.env.local`:
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=The Kings Tribe Finance <finance@mail.yourchurch.org>
   ```
   The address in `EMAIL_FROM` must use the domain you verified.

### 7.5 Test
After Section 10, submit a test requisition through a requisition link. You should receive a confirmation, and the finance notification address should receive a "New requisition" email. Every attempt is listed on the requisition page under **Audit history → Notifications**, showing **sent**, **skipped** (not configured) or **failed** (with the reason).

---

## 8. Set up receipt emails (inbound)

Requesters can **reply to the Purchase Order email with photos or PDFs of receipts**. The app files them against the right PO automatically. Nothing is marked purchased until Finance reconciles.

1. **Choose a receiving address.** In Resend, open **Receiving** (sometimes under **Emails → Receiving**). You get a free address domain like `xxxx.resend.app`. Alternatively, add a receiving domain such as `inbound.yourchurch.org`, which needs one **MX** record in your DNS, added the same way as in 7.3.
2. **Set the address in `.env.local`**, e.g.:
   ```
   RECEIPTS_INBOUND_ADDRESS=receipts@inbound.yourchurch.org
   ```
   The app automatically uses addresses like `receipts+po-3f9a…@inbound.yourchurch.org` as the reply-to, so replies can be matched exactly.
3. **Create the webhook** (after the app is deployed, Section 9):
   1. In Resend, click **Webhooks → Add Webhook**.
   2. **Endpoint URL:** `https://YOUR-PRODUCTION-ADDRESS/api/inbound-email`
   3. **Events:** tick **email.received**.
   4. Click **Add**.
   5. Open the webhook and copy the **Signing Secret** (`whsec_…`).
   6. In Vercel (Section 9.7), add `RESEND_WEBHOOK_SECRET=whsec_…` and redeploy.
4. **Test:** reply to a Purchase Order email with a photo attached. Within a minute it appears on the requisition under **Receipts & reconciliation** as **Awaiting reconciliation**. Emails that can't be matched appear on the **Receipts** page under **Unmatched**.

---

## 9. Deploy to Vercel

### 9.1 GitHub setup (if not already done)
1. Sign in at **https://github.com** and click **+ → New repository**.
2. **Name:** `the-kings-tribe-app`. Choose **Private** (required).
3. Click **Create repository**.
4. Leave the page open and copy the HTTPS address it shows, e.g. `https://github.com/yourname/the-kings-tribe-app.git`.

### 9.2 Push the code
Run in Terminal, in the project folder:
```bash
git remote add origin https://github.com/yourname/the-kings-tribe-app.git
git push -u origin develop
git push origin main
```
**Expected:** "Branch 'develop' set up to track…". If GitHub asks you to sign in, follow the browser prompt.

> **Which branch goes live?** All of the application lives on `develop`. `main` holds only the initial brand-assets commit until you approve merging `develop` into `main`.
> - **When you approve the release:** ask for the merge, then push `main` again.
> - **To try it before the merge:** after importing, go to Vercel → **Settings → Git → Production Branch**, set it to `develop`, then **Redeploy**.

### 9.3 Open Vercel
Go to **https://vercel.com**, click **Sign Up / Log In**, and choose **Continue with GitHub**.

### 9.4 Add a new project
Click **Add New… → Project**.

### 9.5 Import the repository
1. Find `the-kings-tribe-app` and click **Import**.
2. If it isn't listed, click **Adjust GitHub App Permissions** and grant access to the repository.

### 9.6 Configure the framework
- **Framework Preset:** **Next.js** (detected automatically).
- **Root Directory:** leave as `./`.
- **Build Command / Output:** leave the defaults.

### 9.7 Add environment variables
Expand **Environment Variables** and add each name and value from [Section 16](#16-every-environment-variable). Use the same values as `.env.local`, except:
- `NEXT_PUBLIC_APP_URL`: leave it for now; you set it in 9.10.

### 9.8 Deploy
Click **Deploy** and wait 1–3 minutes for "Congratulations!".

### 9.9 Find the production URL
Click **Continue to Dashboard**. The address under **Domains** is your production URL, e.g. `https://the-kings-tribe-app.vercel.app`.

### 9.10 Add the production URL everywhere it is needed
1. In Vercel, go to **Settings → Environment Variables** and set `NEXT_PUBLIC_APP_URL` = your production URL, with no trailing slash.
2. In Supabase, go to **Authentication → URL Configuration**:
   - Set **Site URL** to the production URL.
   - Add **Redirect URL** `https://YOUR-PRODUCTION-URL/auth/callback`.
   - Click **Save**.
3. Create the Resend webhook (Section 8, step 3) and add `RESEND_WEBHOOK_SECRET` in Vercel.

### 9.11 Redeploy
In Vercel, go to **Deployments**, open the **⋯** menu on the latest deployment, and choose **Redeploy**. Environment-variable changes only apply after a redeploy.

### 9.12–9.18 Test the live app
Do Section 10 first (create the Administrator), then run through these:

| # | Test | What success looks like |
|---|---|---|
| 12 | **Login.** Open the production URL and sign in. | The dashboard appears. |
| 13 | **Sunday Entry.** Enter attendance and amounts, then click **Save Sunday entry**. | "Saved" appears and the totals update. The dashboard shows the figures. |
| 14 | **Requisition.** Go to **Administration → Requisition links → New requisition link**, open the link in a private window, and submit a request. | A confirmation number like `TKT-REQ-2026-0001` appears, plus emails. |
| 15 | **Approval.** Open the requisition, click **Review**, then **Approve**. | The status is **Approved** and the requester is emailed. |
| 16 | **PO.** Click **Issue PO**. | **TKT-PO-2026-0001** is created. **Download PDF** works. The requester receives the PO with the PDF attached. |
| 17 | **Order.** Click **Record order**. | The status is **Ordered**. |
| 18 | **Receipt upload.** Click **Upload receipt**, then **Reconcile**. | The status becomes **Partially Purchased** or **Purchased**. |

---

## 10. Create the first Administrator and add your team

### 10.1 First Administrator (one time only)
1. Open `https://YOUR-PRODUCTION-URL/setup` (or `http://localhost:3000/setup` locally).
2. Enter:
   - the **Setup token**: the `SETUP_TOKEN` value;
   - your full name, email and a password of at least 12 characters.
3. Click **Create administrator**. You are signed in and taken to the **Setup wizard**.
4. The setup page then permanently says "Setup is complete". You may now delete `SETUP_TOKEN` from Vercel (and redeploy) for extra safety.

### 10.2 Setup wizard (Administration → Setup wizard)
Work through all six steps:
1. Church information, currency and **timezone**.
2. Finance notification email and policies.
3. Review categories.
4. Review departments.
5. Invite your team.
6. Create a requisition link.

Then click **Mark setup complete**.

### 10.3 Add all 5 internal users
For **each** person (yourself plus four others):

1. Go to **Administration → Users → Invite user**.
2. Enter their **full name** and **email**.
3. Tick their **role(s)**. Suggested starting roles:

   | Person | Role |
   |---|---|
   | You / church administrator | **Administrator** |
   | Head of Finance | **Head of Finance** |
   | Person counting Sunday money | **Finance User** |
   | Person counting attendance | **Reporting User** |
   | Pastor / leader who only views the dashboard | **Viewer** |

4. Choose **Send an invitation email** and click **Invite**.
   - The person receives "You have been invited", clicks **Accept your invitation**, and chooses a password.
   - If an email doesn't arrive (check spam), invite again choosing **Give me a link to send myself**, then send that link privately, e.g. by text.

To change what a role can do, use **Administration → Roles & permissions**. Only Administrators can change permissions or grant the Administrator role. To remove someone, click **Deactivate**; they are signed out immediately and their history is kept.

**Department leads do not get accounts.** Create a link in **Administration → Requisition links** and send it to them. Copy the link when it is shown: only a fingerprint is stored, so it cannot be displayed again.

---

## 11. Optional: your own web address (custom domain)

This does **not** change your main church website. It adds a separate address such as `operations.yourchurch.org`.

1. In Vercel, go to **Project → Settings → Domains**, type `operations.yourchurch.org`, and click **Add**.
2. Vercel shows a record to create, usually **CNAME** `operations` → `cname.vercel-dns.com` (copy exactly what Vercel shows).
3. At your DNS provider (see 7.3):
   1. Click **Add record**.
   2. **Type:** CNAME. **Name/Host:** `operations`. **Value/Target:** the value Vercel showed. **TTL:** default.
   3. Click **Save**.
4. Wait until Vercel shows **Valid Configuration** (minutes to a few hours). HTTPS is set up automatically.
5. Update the address everywhere:
   - In Vercel, set `NEXT_PUBLIC_APP_URL=https://operations.yourchurch.org`, then **Redeploy**.
   - In Supabase, go to **Authentication → URL Configuration**: set **Site URL** to the new address and add `https://operations.yourchurch.org/auth/callback`.
   - In Resend, edit the webhook URL to the new address.
6. Re-send any requisition links (create new ones) so they use the new address. Old links keep working only while the old address works.

---

## 12. Install on iPhone

1. Open the production URL in **Safari**. Other browsers on iPhone cannot install apps.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll and tap **Add to Home Screen**.
4. Confirm the app name **TKT Operations**. You can shorten it.
5. Tap **Add**.
6. Launch it from the Home Screen icon (the gold Kings Tribe mark on navy). It opens full-screen without Safari's address bar.

**PWA troubleshooting:**

| Problem | Fix |
|---|---|
| No "Add to Home Screen" option | Make sure you're in **Safari**, not Chrome or an in-app browser (e.g. one opened from Gmail or Instagram). |
| The icon is a screenshot instead of the logo | Delete the icon, open the site in Safari, wait for it to finish loading, then add it again. |
| It opens with Safari bars | Delete the icon and add it again from **Safari's Share** menu. |
| You're asked to sign in every time | iOS keeps the Home Screen app's sign-in separate from Safari's. Sign in once inside the installed app. |
| The app doesn't show the latest version | Close it fully: swipe up from the bottom and swipe the app away. Reopen it. |
| "You're offline" | Financial information is never stored on the phone. Reconnect to the internet. |

---

## 13. Final acceptance test

Tick each item on the live site. Items marked 🔁 were also verified by automated tests.

**Authentication**
- [ ] Opening `/dashboard` in a private window redirects to the sign-in page. 🔁
- [ ] Each role sees only its sections, e.g. a Viewer has no Requisitions or Administration. 🔁 (database)
- [ ] RLS works: §5.3 shows `unprotected = 0`. 🔁

**Sunday Entry**
- [ ] Attendance saves and the total is correct. 🔁
- [ ] Finance saves and the total is correct to the cent. 🔁
- [ ] Adding a category (e.g. "Youth") makes it appear on Sunday Entry. 🔁

**Dashboard**
- [ ] Figures match what was entered.
- [ ] The date presets and custom range change the charts.
- [ ] Each chart's **Table** toggle shows the numbers.

**Requisition**
- [ ] The link opens the form **without signing in**.
- [ ] Choosing a department shows only its subcategories.
- [ ] **Order** is preselected.
- [ ] **+ Add Item** adds lines and the totals add up.
- [ ] Submitting gives a number like `TKT-REQ-2026-0001`. 🔁
- [ ] Finance receives the notification email.

**Workflow**
- [ ] Approve, Partially approve, Hold (comment required) and Reject (comment required) all work. 🔁
- [ ] Status history lists every change with who and when. 🔁

**Purchase Order**
- [ ] A PO number like `TKT-PO-2026-0001` is created. 🔁
- [ ] The PDF downloads.
- [ ] The PDF shows the **unaltered** official logo, church details, items and totals.
- [ ] The requester receives the PO email with the PDF attached.

**Orders**
- [ ] Two vendor orders can be recorded for one requisition, including partial quantities. 🔁

**Receipts**
- [ ] Uploading a phone photo works.
- [ ] Opening the file uses a link that expires. The bucket is private (§5.4).
- [ ] Two receipts can be reconciled against one request. 🔁
- [ ] Partial quantities lead to **Partially Purchased**; the rest leads to **Purchased**. 🔁
- [ ] Actual cost and variance are shown. 🔁

**Mobile**
- [ ] The form works on iPhone.
- [ ] The dashboard works on iPhone.
- [ ] The app installs on the Home Screen and opens full-screen.

**Security**
- [ ] A requisition-link visitor cannot open any internal page. 🔁
- [ ] Secret keys are only in Vercel's "server" variables (Section 16). 🔁 (build scan)
- [ ] An unsigned POST to `/api/inbound-email` is rejected. 🔁

---

## 14. Optional: SMS text updates (Twilio)

Email works without this; texting is an extra.

1. Sign up at **https://www.twilio.com** and verify your phone.
2. In the Twilio Console, buy a phone number: **Phone Numbers → Buy a number**.
3. US numbers must be registered for **A2P 10DLC** texting. Follow **Messaging → Regulatory Compliance** in Twilio. Approval can take days and has a small monthly fee.
4. Copy the **Account SID** and **Auth Token** from the Console home page.
5. In Vercel, add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` (e.g. `+15551234567`) or `TWILIO_MESSAGING_SERVICE_SID`. Then **Redeploy**.

Requesters who tick **"Also text me status updates"** then receive short texts. Replying STOP opts them out (Twilio handles this automatically), and each email has a link to change preferences. Until Twilio is configured, texts are recorded as "skipped". Nothing is pretended to be sent.

---

## 15. Everyday tasks & troubleshooting

- **New requisition link:** go to **Administration → Requisition links**. Use a separate link per ministry if you want to revoke one without affecting the others.
- **Requesters lost the link:** create a new link and revoke the old one.
- **Remove demo data:** see §5.6.
- **Backups:** Supabase backs up automatically (daily on paid plans). For extra safety, export CSVs monthly from **Reports**.

| Symptom | What to check |
|---|---|
| `/setup` says "Server configuration is incomplete" | The variables it lists are missing in Vercel. Add them and **Redeploy**. |
| `/setup` says "The database is not ready" | The migrations weren't applied. Redo §5.1. |
| Invitation link says "invalid or has expired" | Links work once and expire. Invite again, or use **Give me a link**. Check §6.2 includes `/auth/callback`. |
| No emails at all | `RESEND_API_KEY` / `EMAIL_FROM` are set and the domain is **Verified**. The requisition's **Notifications** list shows the reason. |
| Receipt replies don't appear | The Resend webhook URL ends in `/api/inbound-email`, the `email.received` event is ticked, and `RESEND_WEBHOOK_SECRET` matches. In Resend, open the webhook to see delivery attempts and responses. |
| "You don't have access to that page" | Your role lacks that permission. An Administrator can change it in **Roles & permissions**. |

---

## 16. Every environment variable

| Variable | Required? | Browser-safe / Server-only | Secret? | Where it comes from |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe | No | Supabase Project URL (§4) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Browser-safe | No (protected by RLS) | Supabase publishable / anon key (§4) |
| `NEXT_PUBLIC_APP_URL` | Yes | Browser-safe | No | Your production address (§9.10) |
| `SUPABASE_SECRET_KEY` | Yes | **Server-only** | **Secret** | Supabase secret / service_role key (§4) |
| `SETUP_TOKEN` | Until the first admin exists | **Server-only** | **Secret** | `openssl rand -base64 32` (§4) |
| `RESEND_API_KEY` | For email | **Server-only** | **Secret** | Resend API key (§7.4) |
| `EMAIL_FROM` | For email | **Server-only** | No | Your verified sender (§7.4) |
| `RECEIPTS_INBOUND_ADDRESS` | For receipt emails | **Server-only** | No | Resend receiving address (§8) |
| `RESEND_WEBHOOK_SECRET` | For receipt emails | **Server-only** | **Secret** | Resend webhook signing secret (§8) |
| `RESEND_DELIVERY_WEBHOOK_SECRET` | For email delivery status | **Server-only** | **Secret** | Resend delivery webhook signing secret |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | For phone notifications | Browser-safe | No | `npx web-push generate-vapid-keys` (public key) — see docs/NOTIFICATIONS.md |
| `VAPID_PRIVATE_KEY` | For phone notifications | **Server-only** | **Secret** | Same command (private key) |
| `VAPID_SUBJECT` | For phone notifications | **Server-only** | No | `mailto:` address for push services, e.g. `mailto:operations@yourchurch.org` |
| `TWILIO_ACCOUNT_SID` | Optional | **Server-only** | No | Twilio Console (§14) |
| `TWILIO_AUTH_TOKEN` | Optional | **Server-only** | **Secret** | Twilio Console (§14) |
| `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID` | Optional | **Server-only** | No | Twilio (§14) |

Only variables starting with `NEXT_PUBLIC_` ever reach the browser. Never prefix a secret with `NEXT_PUBLIC_`.
