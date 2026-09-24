# ATSR B2B QA Audit

Internal app for auditing B2B files against the B2B Operations Manual v2.0. An audit is of a file: either a completed file end to end (Posted or Soft Copy Received) or an ongoing file at its current stage. The app shows only the checks that apply to that file's stage and college type, scores the file, scores each person for the part they handled, produces a PDF, and keeps history per team member.

No build step. Plain HTML, CSS and JavaScript. Deploy by uploading the folder.

## Folder

```
index.html          app shell
css/app.css         styles (ATSR brand tokens)
js/config.js        settings: storage endpoint, roles, team seed, RTO list with compliance and notes, cadence reminders
js/criteria.js      THE CHECKS - the only file to edit when the manual changes
js/storage.js       storage adapter (browser-only or shared endpoint)
js/pdf.js           PDF export
js/logo.js          logo as a data URL for the PDF
js/app.js           screens, routing, scoring
assets/             logo and Host Grotesk fonts
```

## Deploy to Vercel

1. Create a new Vercel project and import this folder (drag-and-drop in the dashboard, or push it to a GitHub repo and import that). Framework preset: Other. No build command. Output directory: leave blank.
2. Under Settings > Deployment Protection, turn on Vercel Authentication or a password so the app is not public. It holds staff performance data.
3. Open the deployed URL. The team from `TEAM_SEED` in `js/config.js` is created on first run. Rename them under Manage team.

Any change to a file is a redeploy (push, or upload again).

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

The webhook must allow CORS from the Vercel domain (in the n8n Webhook node: Options > Allowed Origins).

Suggested table (Airtable or Google Sheets), one row per record: `id`, `type`, `file` (fileRef), `date`, `outcome` (summary.outcome), `score` (summary.score), `json` (the full record as text). Per-person results are inside `summary.byPerson` in the JSON. List = read all rows and return the parsed `json` column. Save = upsert on `id`. Delete = delete the row with that `id`. Three short n8n workflows, or one with a Switch on `action`.

Volume is small (a few hundred audits a year), so returning everything on list is fine.

## How an audit works

1. Pick Completed (file at Posted or Soft Copy Received) or Ongoing (any earlier stage, including On Hold).
2. Fill in the file: stage, file reference, qualification, file received date, audit date, RTO. Picking an RTO sets Compliant or Non-compliant; Other lets you type a name and set it by hand.
3. Assign who handled each part of the file (Intake, Drafting, Review and submission, Admin Lead, Posting). Roles prefill this; change it if someone else did the work. Only the parts in scope for that stage are shown.
4. Score each check Pass, Fail or N/A. A Fail needs a note. The result panel shows the file score and each person's score.
5. Save, then Download PDF.

What changes with the file:

- Stage: a check appears once the file has reached the stage where it can be judged (`from`). On Hold checks appear only while the file is On Hold (`only`).
- College type: non-compliant files are checked against the generic checklist and the bare minimum (100-point ID, USI or passport, work evidence). Compliant files are checked against the college's own checklist and process, and the college's notes from `config.js` are shown above the checklist.
- Owner: on non-compliant files the Drafting Admin reviews and the Admin Lead submits. On compliant files whoever took the file over at checklist review reviews and submits, so the Review and submission slot starts unassigned and the auditor picks the person.

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
