/*
  App configuration. Edit here, redeploy, done.
*/

const CONFIG = {
  appName: "B2B QA Audit",

  // Where audits and team members are stored.
  // Leave WEBHOOK_URL empty to store in this browser only (localStorage) - fine for testing.
  // Set it to an n8n webhook URL (or any endpoint that speaks the contract in README.md)
  // and every auditor shares the same records.
  WEBHOOK_URL: "",
  WEBHOOK_KEY: "",          // sent as the x-qa-key header, optional

  // Roles a team member can hold. The role prefills the "who handled this file" slots.
  roles: ["Intake Admin", "Drafting Admin", "Admin Lead", "BD Manager", "Other"],

  // Team members created on first run when the store is empty. Manage in the app after that.
  TEAM_SEED: [
    { name: "Intake Admin 1", role: "Intake Admin" },
    { name: "Drafting Admin 1", role: "Drafting Admin" },
    { name: "Drafting Admin 2", role: "Drafting Admin" },
    { name: "Admin Lead", role: "Admin Lead" },
    { name: "BD Manager", role: "BD Manager" },
  ],

  // RTOs. Picking one sets the compliance status for the audit. "Other" is always offered.
  // notes: shown above the checklist for compliant colleges so the auditor knows what
  // "followed the college's process" means for this RTO. Add one line per rule.
  RTOS: [
    {
      name: "Brighton Pacific Pty T/A AIBT Global",
      short: "AIBT",
      compliant: true,
      notes: [
        "Add AIBT process rules here, one per line (portal, forms, kit, per-qualification conditions).",
      ],
    },
    // { name: "...", short: "...", compliant: false, notes: [] },
  ],

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
    "New hires: every file for the first 10 working days, then 3 a week until two consecutive Pass results.",
    "Admin Lead audits the admin team. COO audits the Admin Lead monthly.",
  ],
};
