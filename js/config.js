/*
  App configuration. Edit here, redeploy, done.
*/

const CONFIG = {
  appName: "B2B QA Audit",

  // The live site. On these hosts audits and team members are stored in Cloudflare (D1) and the
  // server enforces who may delete audits and manage the team. Anywhere else (a local copy, the
  // preview) the app runs in this-browser-only mode. Add a custom domain here if you set one up.
  SHARED_HOSTS: ["atsr-qa-audit.pages.dev"],

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

  // Follow-up cadence reminders, shown above the checklist. The manual's cadence is the
  // compliant one. Non-compliant is lighter in practice - set the actual cadence here.
  CADENCE: {
    compliant: [
      "Missing documents: every 1 to 2 business days (2.1.1). Escalate after 5 business days with no reply.",
      "Outstanding invoice: on the due date, then 2 days later (2.1.2). Escalate when more than a week overdue.",
      "Signed forms: every 2 business days (2.1.1, listing the forms). Escalate after 5 business days.",
      "RTO not responding: after 5 business days (4.1), then again after a further 5.",
    ],
    noncompliant: [
      "Missing documents: lighter than compliant. Confirm the cadence and record it here.",
      "Outstanding invoice: on the due date, then 2 days later (2.1.2). Escalate when more than a week overdue.",
      "Signed forms: every 2 business days (2.1.1, listing the forms). Escalate after 5 business days.",
      "RTO not responding: after 5 business days (4.1), then again after a further 5.",
    ],
  },

  // Suggested sampling, shown on the home page. Text only.
  cadence: [
    "Completed audit: one Posted (or Soft Copy Received) file per admin per week, end to end.",
    "Ongoing audit: one live file per admin per week. The stage decides which checks apply.",
    "Cancelled audit: spot-check cancelled files, for example two a month.",
    "New hires: every file for the first 10 working days, then 3 a week until two consecutive Pass results.",
    "Admin Lead audits the admin team. COO audits the Admin Lead monthly.",
  ],
};
