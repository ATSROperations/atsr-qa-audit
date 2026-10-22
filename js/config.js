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

  // Follow-up cadence reminders, shown above the checklist. RTO follow-up differs by college type:
  // compliant RTOs every 5 business days, less and non-compliant every 2 (Rikuo, Oct 2026).
  CADENCE: {
    compliant: [
      "Missing documents: every 1 to 2 business days (2.1.1). Escalate after 5 business days with no reply.",
      "Outstanding invoice: on the due date, then 2 days later (2.1.2). Escalate when more than a week overdue.",
      "Signed forms: every 2 business days (2.1.1, listing the forms). Escalate after 5 business days.",
      "RTO follow-up: every 5 business days (4.1).",
    ],
    noncompliant: [
      "Missing documents: lighter than compliant. Confirm the cadence and record it here.",
      "Outstanding invoice: on the due date, then 2 days later (2.1.2). Escalate when more than a week overdue.",
      "Signed forms: every 2 business days (2.1.1, listing the forms). Escalate after 5 business days.",
      "RTO follow-up: every 2 business days (4.1).",
    ],
  },

  // How long a complete, paid portfolio may wait before it goes to the RTO. Agents are invoiced
  // weekly, so a complete file should not sit longer than that. Business days (Mon to Fri).
  SUBMIT_WITHIN_BUSINESS_DAYS: 5,   // CONFIRM

  // Suggested sampling, shown on the home page. Text only.
  cadence: [
    "Completed audit: one Posted (or Soft Copy Received) file per admin per week, end to end.",
    "Ongoing audit: one live file per admin per week. The stage decides which checks apply.",
    "Cancelled audit: spot-check cancelled files, for example two a month.",
    "New hires: every file for the first 10 working days, then 3 a week until two consecutive Pass results.",
    "Admin Lead audits the admin team. COO audits the Admin Lead monthly.",
  ],
};
