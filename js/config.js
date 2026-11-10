/*
  App configuration. Edit here, redeploy, done.
*/

const CONFIG = {
  appName: "B2B QA Audit",

  // The live site on Cloudflare. On these hosts the app signs people in and stores everything on the
  // server, which enforces the access rules. The Node server version needs no entry here (it marks its
  // own pages). Anywhere else (a local copy, the preview) the app runs in this-browser-only mode.
  SHARED_HOSTS: ["atsr-qa-audit.pages.dev", "audit.atsrpl.com.au"],

  // Team members created the first time an admin opens an empty app. Manage in the app after that.
  // Job roles themselves are managed in the app (Manage team > Manage roles).
  TEAM_SEED: [
    { name: "Intake Admin 1", roles: ["Intake Admin"] },
    { name: "Drafting Admin 1", roles: ["Drafting Admin"] },
    { name: "Compliant Colleges Admin 1", roles: ["Compliant Colleges Admin", "Drafting Admin"] },
    { name: "Admin Lead", roles: ["Admin Lead"] },
    { name: "Bookkeeper", roles: ["Bookkeeper"] },
    { name: "BD Manager", roles: ["BD Manager"] },
  ],

  // RTOs and qualifications: functions/api/master-data.js (built from the ATSR Master File).
  // College process notes: functions/api/college-notes.js. Both are only sent to signed-in users.
  //
  // Which compliance levels follow the college-specific process, and which the generic
  // checklist. The auditor can still switch the track on an audit.
  TRACK_BY_LEVEL: {
    "Compliant": "compliant",
    "Less Compliant": "noncompliant",   // CONFIRM: generic checklist or college-specific?
    "Non Compliant": "noncompliant",
  },

  // Follow-up cadence reminders, shown above the checklist. RTO follow-up differs by college type
  // (CEO standards, Nov 2026): every 2 days for less and non-compliant RTOs, every 7 days for compliant.
  CADENCE: {
    compliant: [
      "Missing documents: the full list in one email (two at most) the first time, then every 1 to 2 business days (2.1.1). Escalate to the BD Manager after 5 days with no movement.",
      "Forms: pre-filled and sent within 2 days of opportunity creation; RPL kit within 10 days.",
      "Outstanding invoice: weekly follow-up on every due payment, individual or bulk (2.1.2).",
      "Signed forms: every 2 business days (2.1.1, listing the forms). Escalate after 5 business days.",
      "RTO follow-up: every 7 days (4.1). Target: portfolio at the RTO within 2 weeks of receipt.",
    ],
    noncompliant: [
      "Missing documents: bare minimum only, asked for in one straightforward email. Escalate to the BD Manager after 5 days with no movement.",
      "Outstanding invoice: weekly follow-up on every due payment, individual or bulk (2.1.2).",
      "Signed forms: every 2 business days (2.1.1, listing the forms). Escalate after 5 business days.",
      "RTO follow-up: every 2 days (4.1). Target: portfolio at the RTO within 2 days of receipt.",
    ],
  },

  // Timing targets (CEO standards, Nov 2026), business days (Mon to Fri). Shown in the file facts
  // and used by checks SU-06, CP-01 and SU-07.
  SUBMIT_WITHIN_BUSINESS_DAYS: 1,                       // complete and paid -> sent to the RTO
  RECEIPT_TO_RTO_BUSINESS_DAYS: { noncompliant: 2, compliant: 10 },   // file received -> sent to the RTO
  INVOICE_WITHIN_WORKING_HOURS: 6,                      // RTO and amount assigned -> invoice sent (IV-05)

  // Suggested sampling, shown on the home page. Text only.
  cadence: [
    "Completed audit: one Posted (or Soft Copy Received) file per admin per week, end to end.",
    "Ongoing audit: one live file per admin per week. The stage decides which checks apply.",
    "Cancelled audit: spot-check cancelled files, for example two a month.",
    "New hires: every file for the first 10 working days, then 3 a week until two consecutive Pass results.",
    "Admin Lead audits the admin team. COO audits the Admin Lead monthly.",
  ],
};
