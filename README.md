# ATSR B2B QA Audit

Internal app for auditing B2B files against the B2B Operations Manual v2.0. An audit is of a file: a completed file end to end (Posted or Soft Copy Received), an ongoing file at its current stage, or a cancelled file. The app shows only the checks that apply to that file's stage and college type, scores the file, scores each person for the part they handled, produces a PDF, and keeps history per team member.

No build step. Plain HTML, CSS and JavaScript, plus one API file. Runs on ATSR's Hetzner server (Node.js behind Nginx) or on Cloudflare Pages with no code changes.

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
functions/api/      server API: sign-in, logins, roles, records, permissions (shared by both hosts)
server/             Node.js server: server.mjs, db.mjs (SQLite), import.mjs, README.md (Hetzner setup guide)
deploy/             Hetzner files: systemd service, auto-update timer + update.sh, Nginx site, settings template
package.json        npm start runs the Node server (no dependencies)
js/pdf.js           PDF export
js/logo.js          logo and tick watermark as data URLs for the PDF
js/app.js           screens, routing, scoring
js/theme.js         light / dark toggle
assets/             ATSR logos (light and dark versions), tick favicon and watermark, Host Grotesk fonts
```

## Hosting

ATSR runs this on its Hetzner server: Node.js behind Nginx, with the database as a SQLite file. Setup, data move from Cloudflare, domain, HTTPS, updates, backups and restore: **server/README.md**.

The same code still deploys to Cloudflare Pages (D1 binding `DB` plus the secrets below) if ever needed. Both hosts run `functions/api/[[path]].js` unchanged; only the database underneath differs (D1 on Cloudflare, a SQLite file on the Node server).

## Sign-in, storage and permissions

On the live site (served by the Node server, or a Cloudflare host listed in `SHARED_HOSTS` in `js/config.js`) the app has its own sign-in. Records, team members, roles and logins are stored on the server through `functions/api/[[path]].js`, which enforces every rule below. The app hides buttons people can't use, but the server is what enforces it, so the rules hold even if someone edits the page in their browser.

Access levels:

- **Owner** (the email in `OWNER_EMAIL`, default operations@atsrpl.com.au): everything, including creating logins, resetting passwords, setting access levels and disabling accounts.
- **Admin**: delete audits, add/rename/archive/delete team members, manage job roles.
- **Auditor**: view everything, add audits, change their own password.

Rules:

- Only the people who audit need a login. Team members are separate: they are the people whose work gets audited and need no login.
- The owner creates each login (name, email, level). The app shows a temporary password once; the person sets their own at first sign-in. Reset works the same way.
- Passwords are hashed with a per-user salt and a secret pepper kept in Cloudflare. Five failed attempts lock the account for 15 minutes. Sessions last 7 days.
- An audit moves through three states. **In progress**: scoring not finished; only the person who started it, or an admin, can change it, and the PDFs are marked "in progress". **Awaiting coaching**: the auditor pressed Save scores; the scores and file details are now locked, the PDFs go to the person, and coaching happens. **Final**: the coaching log and commitments are recorded and the audit is closed.
- Coaching fields (coaching date, whole-file note, each person's coaching notes and commitment) are open to every auditor on a scored or final audit, from Log coaching on the audit page. Each save is listed in the audit's history.
- Changing anything that is locked (a score, a finding note, who handled a part, file details): an admin or the owner edits it and must give a reason; it applies at once and is logged with the reason and the exact changes. An auditor uses Request a change: the proposed changes and the reason are held on the audit until an admin or the owner approves (applied) or rejects them (nothing changes). One request at a time per audit. Everything is listed in the audit's history and in the file PDF's change history. The original auditor's name always stays on the audit.
- Every audit is stamped with the signed-in user's name and email.
- A team member with audits can be archived, not deleted.
- A person can hold several job roles. Roles are managed in the app (Manage team > Manage roles) and each says which part of a file it prefills.

Anywhere else (a local copy, the preview) the app runs in this-browser-only mode with no sign-in.

### One-time setup (Cloudflare only; for Hetzner see server/README.md)

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
3. Assign who handled each part of the file. Roles prefill this; change it if someone else did the work. Only the parts in scope are shown. If two people worked on a part (two drafters, say), use "+ add another person" under that part, then pick them on the checks they did with the "who did this" dropdown; both get their own score and their own PDF copy. Each check also shows who is answerable for it as a chip ("from part" means it follows the part above). Use the "+ person" dropdown on the check to add anyone, including a second or third person when a check was shared; a shared check counts in every one of their scores and appears on each of their PDF copies. Remove a chip with its x, or press reset to go back to the part's person. A person not listed on that part shows "reassigned".
4. Score each check Pass, Fail or N/A. A Fail needs a note. On cancelled files, use N/A for steps that never happened.
5. Save scores (locks the scores) or Save, still in progress (keeps everything open; needs only a file reference). Then download the **File PDF** (everything, for the auditor and lead) or **Their copy** for each person (only their checks and score, the file result stated neutrally, and their own coaching notes and commitment) and send it ahead of the coaching.
6. After coaching, open the audit and press Log coaching: coaching date, whole-file note, and for each person what was discussed and what they committed to. Tick "Coaching done" to mark the audit final. If something came up that should change a score, use Edit (admin, with a reason) or Request a change (auditor; an admin approves). The whole-file note never appears on a person's copy, so it can mention anyone.

Dates on the audit: file received, portfolio complete (from Complete Portfolio onward) and sent to RTO (from Portfolio Sent to College onward). From these the app shows, in business days, the time from receipt to the RTO against the target for the file type (2 generic, 10 compliant) and the submission wait from complete to sent (1). Checks SU-07, CP-01 and SU-06 score them.

What changes with the file:

- Stage: a check appears once the file has reached the stage where it can be judged (`from`). On Hold checks appear only while the file is On Hold (`only`). Cancelled files get every check up to the last stage reached, plus six cancellation checks from SOP 12.
- Checklist track: set from the RTO's compliance level through `TRACK_BY_LEVEL` in config.js, and changeable on the audit. Generic checklist: bare minimum only (100-point ID, USI or passport, work evidence). College-specific process: the college's own checklist and rules, with the college's notes shown above the checks.
- Owner: each part of the file (Intake, Drafting, Review and submission, Admin Lead, Accounts, Posting, Cancellation) is prefilled with the first team member whose role maps to it. On compliant-college files the Review and submission part is prefilled from the Compliant Colleges Admin role; on generic files from the Drafting Admin role. Accounts is prefilled from the Bookkeeper role. The auditor can change any of it, and reassign a single check.

## Updating RTOs and qualifications

Two ways:

- Small change: edit the row in `functions/api/master-data.js` on GitHub (one RTO or qualification per line) and commit.
- Master File changed a lot: run `python3 tools/build_master_data.py "ATSR Master File.xlsx"` from the project folder (needs `pip install openpyxl`), then commit the new `functions/api/master-data.js`.

College notes live in `functions/api/college-notes.js`, keyed by RTO code, so rebuilding the data never wipes them.

## Maintaining the checks

Everything is in `js/criteria.js`.

- One list of checks, grouped into the sections the CEO set (Nov 2026): Intake and Inquiry; RTO Assignment and Initial Check; Invoicing and Payments; RTO Documents; Drafting, Portfolio Review and Follow-up; (On Hold, only while on hold); RTO Submission and Communication; Soft Copy; Hard Copy and Posting; (Cancellation, cancelled files only). Items keep their original ids even when they move section, so older audits still display.
- Job roles (Admin Lead, BD Manager, Bookkeeper and so on) are not in this file: admins add, edit and delete them in the app under Manage team > Manage roles, and say which part of a file each one prefills. Editing a name changes it on everyone holding the role; deleting a role removes it from everyone holding it (audits are untouched). The default roles are seeded once; a deleted default does not come back. Each check has `from` (earliest stage), optional `only`, `for` (all, compliant, noncompliant), `owner` and `critical`.
- Every check carries the SOP reference it came from. When a chapter of the manual changes, search the file for that reference and edit only those checks.
- `critical: true` means one Fail fails the audit regardless of the percentage. Keep this for the checks that cost money, breach privacy or reach the agent.
- RTO follow-up cadence: every 2 days for less and non-compliant RTOs, every 7 days for compliant (check SU-05 and the cadence box in config.js).
- Timing targets live in `config.js`: `SUBMIT_WITHIN_BUSINESS_DAYS` (complete and paid to sent, 1), `RECEIPT_TO_RTO_BUSINESS_DAYS` (received to sent: 2 generic, 10 compliant), `INVOICE_WITHIN_WORKING_HOURS` (6). The file facts show the measured days against them; checks CP-01, SU-06 and SU-07 score them.
- Checks marked `CEO standards` come from the CEO's feedback of Nov 2026, not from the manual. When the manual is updated to match, change the `ref`.
- Never reuse an id. Saved audits store results by id.
- Bump `version` whenever a check changes. Every saved audit records the version it was scored against, and the PDF prints it.
- Thresholds (`pass: 0.9`, `coaching: 0.75`) are at the top of the same file.

`js/config.js` holds the RTO list (name, short name, compliant true/false, process notes shown to the auditor for compliant colleges), the follow-up cadence reminders per college type, roles, the team seed and the sampling text. College-specific rules go in the RTO's `notes`, not in the checks.

## PDF

Download PDF on any audit produces a branded A4 PDF: file details, stage, RTO and college type, days from receipt to audit, file score and outcome, a per-person table, the findings grouped by phase with who was answerable and the notes, the coaching note, and the manual and checks version in the footer. File name `QA_<file>_<date>_<completed|ongoing>.pdf`. The PDF library loads from cdnjs; the rest of the app works offline.

## Brand, light and dark mode

Styled to the ATSR Brand and Design System v1.1 (Nov 2026): Canvas Cream page, white cards with 18px corners and the soft Teal shadow, Charcoal headings and body, Teal links and labels, the Turquoise to Lime gradient on primary buttons, pill buttons and inputs, Host Grotesk throughout. Status colours: Pass in Teal/Turquoise, Needs coaching in Periwinkle, Fail in red (the one colour outside the palette, because the brand has none for errors).

The app follows the device's light or dark setting on first visit. The sun / moon button in the top bar switches it and remembers the choice in that browser. Light mode uses the full-colour logo; dark mode uses Teal panels with Canvas Cream text and the solid Canvas Cream logo (never the gradient-tick logo on Teal). The favicon is the Teal tick; a passing score shows a faint tick watermark. PDFs are always light (they are printed and filed), with the full-colour logo in the header and a pale Teal tick as a page watermark. The PDF text is Helvetica, the brand's stated fallback for Host Grotesk.

Warbler (the accent font) is not used: the files in the asset pack carry a testing licence that does not cover websites.

Brand images live in `assets/` (web) and `js/logo.js` (PDF), all generated from the official Brand Assets pack. To update them, replace the PNGs with the official files of the same names and regenerate `js/logo.js` from the new PNGs. Colour tokens are at the top of `css/app.css`.
