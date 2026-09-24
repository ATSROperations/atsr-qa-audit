# ATSR B2B QA Audit

Internal app for auditing B2B files against the B2B Operations Manual v2.0. An audit is of a file: a completed file end to end (Posted or Soft Copy Received), an ongoing file at its current stage, or a cancelled file. The app shows only the checks that apply to that file's stage and college type, scores the file, scores each person for the part they handled, produces a PDF, and keeps history per team member.

No build step. Plain HTML, CSS and JavaScript. Host by uploading the folder.

## Folder

```
index.html          app shell
css/app.css         styles (ATSR brand tokens)
js/config.js        settings: storage endpoint, roles, team seed, compliance level to checklist track, college notes, cadence reminders
js/criteria.js      THE CHECKS - the only file to edit when the manual changes
js/master-data.js   RTOs and qualifications, built from the ATSR Master File
tools/              build_master_data.py rebuilds master-data.js from the Master File
js/storage.js       storage adapter (browser-only or shared endpoint)
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

## Storage

Two modes, chosen by one setting in `js/config.js`:

- `WEBHOOK_URL` empty: records live in the auditor's browser only (localStorage). Good for testing. Backup and import are under the Backup link on the home page.
- `WEBHOOK_URL` set: every auditor reads and writes the same records through that endpoint. This is the production setting.

### Endpoint contract (n8n webhook, or anything else)

A record is a JSON object with at least `id` and `type` (`member` or `audit`). The app never needs the server to understand the rest; store the whole record as JSON and return it as-is.

| Call | Request | Response |
|---|---|---|
| List | `GET {WEBHOOK_URL}?action=list` | JSON array of all records (or `{ "records": [...] }`) |
| Save (upsert by id) | `POST {WEBHOOK_URL}` body `{ "action": "save", "record": { ... } }` | any 2xx |
| Delete | `POST {WEBHOOK_URL}` body `{ "action": "delete", "id": "QA-..." }` | any 2xx |

If `WEBHOOK_KEY` is set, it is sent as the `x-qa-key` header on every call. Reject requests without it.

The webhook must allow CORS from the app's domain (in the n8n Webhook node: Options > Allowed Origins).

Suggested table (Airtable or Google Sheets), one row per record: `id`, `type`, `file` (fileRef), `date`, `outcome` (summary.outcome), `score` (summary.score), `json` (the full record as text). Per-person results are inside `summary.byPerson` in the JSON. List = read all rows and return the parsed `json` column. Save = upsert on `id`. Delete = delete the row with that `id`. Three short n8n workflows, or one with a Switch on `action`.

Volume is small (a few hundred audits a year), so returning everything on list is fine.

## How an audit works

1. Pick the audit type. Completed: the file is at Posted or Soft Copy Received. Ongoing: any earlier stage, including On Hold. Cancelled: pick the last stage the file reached before it was cancelled.
2. Fill in the file: stage, file reference, qualification (type the code, the title and entry requirement appear), file received date, audit date, RTO. The RTO list comes from the Master File, grouped by compliance level, with archived RTOs at the bottom. Picking the RTO shows its compliance level, Process To and type, and sets the checklist track.
3. Assign who handled each part of the file. Roles prefill this; change it if someone else did the work. Only the parts in scope are shown.
4. Score each check Pass, Fail or N/A. A Fail needs a note. On cancelled files, use N/A for steps that never happened.
5. Save, then Download PDF.

What changes with the file:

- Stage: a check appears once the file has reached the stage where it can be judged (`from`). On Hold checks appear only while the file is On Hold (`only`). Cancelled files get every check up to the last stage reached, plus six cancellation checks from SOP 12.
- Checklist track: set from the RTO's compliance level through `TRACK_BY_LEVEL` in config.js, and changeable on the audit. Generic checklist: bare minimum only (100-point ID, USI or passport, work evidence). College-specific process: the college's own checklist and rules, with the college's notes from `COLLEGE_NOTES` shown above the checks.
- Owner: on the generic track the Drafting Admin reviews and the Admin Lead submits. On the college-specific track whoever took the file over reviews and submits, so the Review and submission slot starts unassigned. Cancellation checks default to the Admin Lead.

## Updating RTOs and qualifications

Two ways:

- Small change: edit the row in `js/master-data.js` on GitHub (one RTO or qualification per line) and commit.
- Master File changed a lot: run `python3 tools/build_master_data.py "ATSR Master File.xlsx"` from the project folder (needs `pip install openpyxl`), then commit the new `js/master-data.js`.

College notes live in `config.js` under `COLLEGE_NOTES`, keyed by RTO code, so rebuilding the data never wipes them.

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
