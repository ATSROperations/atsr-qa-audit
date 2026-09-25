# ATSR B2B QA Audit

Internal app for auditing B2B files against the B2B Operations Manual v2.0. An audit is of a file: a completed file end to end (Posted or Soft Copy Received), an ongoing file at its current stage, or a cancelled file. The app shows only the checks that apply to that file's stage and college type, scores the file, scores each person for the part they handled, produces a PDF, and keeps history per team member.

No build step. Plain HTML, CSS and JavaScript. Host by uploading the folder.

## Folder

```
index.html          app shell
css/app.css         styles (ATSR brand tokens)
js/config.js        settings: live hosts, team seed, compliance level to checklist track, cadence reminders
js/criteria.js      THE CHECKS - the only file to edit when the manual changes
functions/api/master-data.js   RTOs and qualifications, built from the ATSR Master File (only sent to signed-in users)
functions/api/college-notes.js College process notes, keyed by RTO code (only sent to signed-in users)
tools/              build_master_data.py rebuilds master-data.js from the Master File
js/storage.js       storage adapter (Cloudflare on the live site, this browser elsewhere)
functions/api/      server API: sign-in, logins, roles, records in Cloudflare D1, permissions
js/pdf.js           PDF export
js/logo.js          logo and tick watermark as data URLs for the PDF
js/app.js           screens, routing, scoring
js/theme.js         light / dark toggle
assets/             ATSR logos (light and dark versions), tick favicon and watermark, Host Grotesk fonts
```

## Hosting (free)

Cloudflare Pages for the site, Cloudflare Access for the login. Both free, both allow business use.

1. Create a Cloudflare account (free). Workers & Pages > Create > Pages > Upload assets. Drag this folder in. You get a `*.pages.dev` URL. Add `qa.atsrpl.com.au` under Custom domains if the domain is on Cloudflare (optional).
2. Zero Trust (left menu) > pick the Free plan > Access > Applications > Add an application > Self-hosted. Domain: the pages.dev URL (or the custom domain). Policy: Allow, include Emails ending in `@atsrpl.com.au`, or list the auditors' emails. Identity: the default one-time PIN by email is enough; Google login can be added later.
3. Open the URL. The team from `TEAM_SEED` in `js/config.js` is created on first run. Rename them under Manage team.

Any change to a file is a re-upload of the folder (or connect a GitHub repo for automatic deploys).

Vercel's free Hobby plan is for non-commercial personal use only and its password protection is a paid feature, so it is not the right home for this.

## Sign-in, storage and permissions

On the live site (hosts listed in `SHARED_HOSTS` in `js/config.js`) the app has its own sign-in. Records, team members, roles and logins are stored in a Cloudflare D1 database through `functions/api/[[path]].js`, which enforces every rule below. The app hides buttons people can't use, but the server is what enforces it, so the rules hold even if someone edits the page in their browser.

Access levels:

- **Owner** (the email in `OWNER_EMAIL`, default operations@atsrpl.com.au): everything, including creating logins, resetting passwords, setting access levels and disabling accounts.
- **Admin**: delete audits, add/rename/archive/delete team members, manage job roles.
- **Auditor**: view everything, add audits, change their own password.

Rules:

- Only the people who audit need a login. Team members are separate: they are the people whose work gets audited and need no login.
- The owner creates each login (name, email, level). The app shows a temporary password once; the person sets their own at first sign-in. Reset works the same way.
- Passwords are hashed with a per-user salt and a secret pepper kept in Cloudflare. Five failed attempts lock the account for 15 minutes. Sessions last 7 days.
- Saved audits cannot be changed by anyone. Deletes are soft: the row stays in D1 with who deleted it and when.
- Every audit is stamped with the signed-in user's name and email.
- A team member with audits can be archived, not deleted.
- A person can hold several job roles. Roles are managed in the app (Manage team > Manage roles) and each says which part of a file it prefills.

Anywhere else (a local copy, the preview) the app runs in this-browser-only mode with no sign-in.

### One-time setup

1. Cloudflare dashboard > Storage & Databases > D1 > Create database. Name it `atsr-qa-audit`.
2. Workers & Pages > the `atsr-qa-audit` project > Settings > Bindings > Add > D1 database. Variable name `DB`, database `atsr-qa-audit`, environment Production. Save.
3. Same project > Settings > Variables and Secrets > Add (environment Production), all as **Secret**:
   - `OWNER_INITIAL_PASSWORD`: any password. It is used exactly once, the first time the owner email signs in; you are then asked to choose your real password.
   - `AUTH_PEPPER`: a long random string (30+ characters). Set it once and never change it; changing it invalidates every password.
   - Optional: `OWNER_EMAIL` (default operations@atsrpl.com.au), `AUTH_ITERATIONS` (default 50000; raise to 100000 or more on the Workers Paid plan).
4. If Cloudflare Access is still switched on for this project, turn it off: Zero Trust > Access controls > Applications > delete the app, and in the Pages project Settings disable the Access policy. Otherwise people get two logins.
5. Push the code (or retry the latest deployment) so the deployment picks up the binding and secrets. The tables are created automatically on first use.
6. Open the site, sign in with the owner email and `OWNER_INITIAL_PASSWORD`, set your real password, then rename your account under Logins so your name prints on audits.

If the app shows "Storage is not set up", the binding is missing or the deployment predates it. If the first sign-in says "Wrong email or password", `OWNER_INITIAL_PASSWORD` is not set on the Production environment or the deployment predates it.

To recover a deleted audit: D1 > the database > Console, `UPDATE records SET deleted_at = NULL, deleted_by = NULL WHERE id = 'QA-...';`

Free tier limits (5 GB, millions of reads a day) are far above what this app uses.

## How an audit works

1. Pick the audit type. Completed: the file is at Posted or Soft Copy Received. Ongoing: any earlier stage, including On Hold. Cancelled: pick the last stage the file reached before it was cancelled.
2. Fill in the file: stage, file reference, qualification (type the code, the title and entry requirement appear), file received date, audit date, RTO. The RTO list comes from the Master File, grouped by compliance level, with archived RTOs at the bottom. Picking the RTO shows its compliance level, Process To and type, and sets the checklist track.
3. Assign who handled each part of the file. Roles prefill this; change it if someone else did the work. Only the parts in scope are shown.
4. Score each check Pass, Fail or N/A. A Fail needs a note. On cancelled files, use N/A for steps that never happened.
5. Save, then Download PDF.

What changes with the file:

- Stage: a check appears once the file has reached the stage where it can be judged (`from`). On Hold checks appear only while the file is On Hold (`only`). Cancelled files get every check up to the last stage reached, plus six cancellation checks from SOP 12.
- Checklist track: set from the RTO's compliance level through `TRACK_BY_LEVEL` in config.js, and changeable on the audit. Generic checklist: bare minimum only (100-point ID, USI or passport, work evidence). College-specific process: the college's own checklist and rules, with the college's notes shown above the checks.
- Owner: each part of the file is prefilled with the first team member whose role maps to it. On compliant-college files the Review and submission part is prefilled from the Compliant Colleges Admin role; on generic files from the Drafting Admin role. The auditor can change any of it.

## Updating RTOs and qualifications

Two ways:

- Small change: edit the row in `functions/api/master-data.js` on GitHub (one RTO or qualification per line) and commit.
- Master File changed a lot: run `python3 tools/build_master_data.py "ATSR Master File.xlsx"` from the project folder (needs `pip install openpyxl`), then commit the new `functions/api/master-data.js`.

College notes live in `functions/api/college-notes.js`, keyed by RTO code, so rebuilding the data never wipes them.

## Maintaining the checks

Everything is in `js/criteria.js`.

- One list of checks, grouped by phase of the file journey. Each check has `from` (earliest stage), optional `only`, `for` (all, compliant, noncompliant), `owner` and `critical`.
- Every check carries the SOP reference it came from. When a chapter of the manual changes, search the file for that reference and edit only those checks.
- `critical: true` means one Fail fails the audit regardless of the percentage. Keep this for the checks that cost money, breach privacy or reach the agent.
- Never reuse an id. Saved audits store results by id.
- Bump `version` whenever a check changes. Every saved audit records the version it was scored against, and the PDF prints it.
- Thresholds (`pass: 0.9`, `coaching: 0.75`) are at the top of the same file.

`js/config.js` holds the RTO list (name, short name, compliant true/false, process notes shown to the auditor for compliant colleges), the follow-up cadence reminders per college type, roles, the team seed and the sampling text. College-specific rules go in the RTO's `notes`, not in the checks.

## PDF

Download PDF on any audit produces a branded A4 PDF: file details, stage, RTO and college type, days from receipt to audit, file score and outcome, a per-person table, the findings grouped by phase with who was answerable and the notes, the coaching note, and the manual and checks version in the footer. File name `QA_<file>_<date>_<completed|ongoing>.pdf`. The PDF library loads from cdnjs; the rest of the app works offline.

## Light and dark mode

The app follows the device's light or dark setting on first visit. The sun / moon button in the top bar switches it and remembers the choice in that browser. The top bar uses the dark-text ATSR logo in light mode and the light-text logo in dark mode. The favicon is the gradient tick; a passing score shows a faint tick watermark. PDFs are always light (they are printed and filed), with the ATSR logo in the header and the mint tick as a page watermark.

Brand images live in `assets/` (web) and `js/logo.js` (PDF). To swap the logo, replace `assets/logo-h.png` and `assets/logo-h-w.png` with same-named files; for the PDF, regenerate `js/logo.js` from the new PNGs.
