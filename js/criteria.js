/*
  ATSR B2B QA audit criteria. ONE list of checks for the whole file journey.
  This is the only file to edit when the B2B Operations Manual changes.

  An audit is of a FILE. The app shows only the checks that apply to that file:
    - from:  the earliest pipeline stage at which the check can be judged (see stages, rank)
    - only:  optional, the check appears only when the file is at one of these stages
    - for:   "all", "compliant" or "noncompliant" (the RTO's compliance status)
    - owner: which person on the file is answerable. A string, or an object keyed by
             compliance when the owner changes with the file type.

  Rules for editing:
    - Every check comes from the manual (or, for compliant colleges, the college's own
      process). Quote the reference in "ref".
    - critical: true means one Fail on that check fails the whole audit.
    - Never reuse an id. Old audits store results by id.
    - Bump "version" whenever a check changes. It is printed on every PDF.
*/

const CRITERIA = {
  version: "2.0",
  manual: "B2B Operations Manual v2.0 (ATSR-OPS-B2B-MANUAL)",
  thresholds: { pass: 0.9, coaching: 0.75 },

  // B2B RPL Pipeline stages (Appendix A). rank drives which checks are in scope.
  stages: [
    { letter: "A", name: "File Received", rank: 1, type: "ongoing" },
    { letter: "B", name: "Incomplete Portfolio", rank: 2, type: "ongoing" },
    { letter: "C", name: "On Hold", rank: 2, type: "ongoing" },
    { letter: "D", name: "Complete Portfolio", rank: 3, type: "ongoing" },
    { letter: "E", name: "Portfolio Sent to College", rank: 4, type: "ongoing" },
    { letter: "F", name: "Soft Copy Received", rank: 5, type: "completed" },
    { letter: "G", name: "Posted", rank: 6, type: "completed" },
  ],

  // Who is answerable. The audit header assigns a team member to each slot in scope.
  slots: [
    { id: "intake", label: "Intake", defaultRole: "Intake Admin" },
    { id: "drafting", label: "Drafting", defaultRole: "Drafting Admin" },
    { id: "review", label: "Review and submission", defaultRole: { noncompliant: "Drafting Admin", compliant: null } },
    { id: "lead", label: "Admin Lead", defaultRole: "Admin Lead" },
    { id: "posting", label: "Posting", defaultRole: "BD Manager" },
  ],

  phases: [
    { id: "intake", title: "Intake and setup", sop: "SOP 01, 02" },
    { id: "assign", title: "RTO assignment", sop: "SOP 02 step 3" },
    { id: "drafting", title: "Drafting and checks", sop: "SOP 03 to 06" },
    { id: "review", title: "Portfolio review and follow-up", sop: "SOP 07, 14" },
    { id: "invoice", title: "Invoice and forms", sop: "SOP 08, 09" },
    { id: "hold", title: "On Hold", sop: "SOP 12" },
    { id: "submission", title: "Submission and RTO", sop: "SOP 10" },
    { id: "softcopy", title: "Soft copy", sop: "SOP 11" },
    { id: "posting", title: "Hard copy and posting", sop: "SOP 11" },
  ],

  items: [
    // ---- Intake and setup -------------------------------------------------
    { id: "IN-01", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "SOP 01 / SOP 14",
      text: "File acknowledged to the agent the same day with template 1.0, in the thread the file arrived in. No new email started for an existing applicant." },
    { id: "IN-02", phase: "intake", owner: "intake", from: 1, for: "all", critical: true, ref: "SOP 02 / Rule 2",
      text: "Opportunity created under the existing agent contact, one per applicant per qualification. No person-contact created for the applicant." },
    { id: "IN-03", phase: "intake", owner: "intake", from: 1, for: "all", critical: true, ref: "SOP 02",
      text: "Opportunity name matches the passport character for character." },
    { id: "IN-04", phase: "intake", owner: "intake", from: 1, for: "all", critical: true, ref: "SOP 02 / Rule 3 / Rule 6",
      text: "Lead Source chosen from the dropdown, standard Source field untouched, auto fields not typed by hand. Automations confirmed after save and refresh; any miss reported the same day." },
    { id: "IN-05", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "SOP 02",
      text: "Fields filled in the manual's order (qualification, compliant?, SOA) and the agent's special instructions copied into the notes." },

    // ---- RTO assignment ---------------------------------------------------
    { id: "AS-01", phase: "assign", owner: "lead", from: 1, for: "all", critical: true, ref: "SOP 02 step 3 / SOP 08",
      text: "RTO, Compliance Level, Process To and RPL Inv - Amount set by the Admin Lead before drafting or invoicing started. Amount taken from the price list, not estimated." },

    // ---- Drafting and checks ----------------------------------------------
    { id: "DR-01", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: false, ref: "SOP 03",
      text: "Drive folder at Applications > Month-Year > Applicant Name_Qualification with all nine numbered sub-folders. Everything the agent sent downloaded, counted, renamed and filed. No loose files, duplicates or IMG_xxxx names." },
    { id: "DR-02", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "SOP 03 / Rule 4",
      text: "Unique identifier recorded on the opportunity: USI for onshore, passport number for offshore." },
    { id: "DR-03", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "SOP 04",
      text: "ID documents usable (legible, four corners visible, current where required) and totalling 100 points, or the shortfall recorded as points still needed, not as a document name." },
    { id: "DR-04", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "SOP 05",
      text: "USI is 10 characters, name matches the passport, VET transcript filed. Any existing qualification in the same field reported." },
    { id: "DR-05", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: false, ref: "SOP 06",
      text: "Visa checked against Appendix E for onshore non-citizens and recorded in GHL. No visa copy chased where it is not required." },
    { id: "DR-06", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "Rule 7",
      text: "Personal information protected: ID documents stayed in the applicant's Drive folder. Surname, date of birth and ID numbers blurred in any screenshot, training material or chat." },

    // ---- Portfolio review and follow-up -----------------------------------
    { id: "RV-01", phase: "review", owner: "review", from: 2, for: "noncompliant", critical: true, ref: "SOP 07 / ATSR practice",
      text: "Portfolio checked against the generic checklist and the bare minimum is in place: 100-point ID, USI or passport number, work evidence. Documents not scrutinised beyond that." },
    { id: "RV-02", phase: "review", owner: "review", from: 2, for: "compliant", critical: true, ref: "SOP 07 / college process",
      text: "Portfolio checked against this college's own checklist for this qualification, and the college's specific rules for this file followed (see the college notes shown above the checklist)." },
    { id: "RV-03", phase: "review", owner: "review", from: 2, for: "all", critical: true, ref: "SOP 07 / Rule 5",
      text: "Missing Documents recorded in GHL and the selections cleared the same day items arrive. Cleared before the stage moved to Portfolio Sent to College." },
    { id: "RV-04", phase: "review", owner: "review", from: 2, for: "all", critical: true, ref: "SOP 07 / Appendix A",
      text: "Stage matches reality: Incomplete Portfolio while anything is missing, Complete Portfolio only when nothing is." },
    { id: "RV-05", phase: "review", owner: "review", from: 2, for: "all", critical: false, ref: "SOP 07 / SOP 14",
      text: "Missing-documents request (2.1) sent in the existing thread and lists the specific items. Follow-ups sent at the cadence for this file type (see the cadence shown above the checklist). Last File Update set every time." },
    { id: "RV-06", phase: "review", owner: "lead", from: 2, for: "all", critical: false, ref: "SOP 07",
      text: "Documents stuck for more than 5 business days escalated to the agent's principal and logged on the opportunity." },

    // ---- Invoice and forms (parallel track) -------------------------------
    { id: "IV-01", phase: "invoice", owner: "intake", from: 2, for: "all", critical: true, ref: "SOP 08",
      text: "Invoice draft created only after the amount was set. Named Opportunity Name_Invoice Number. Sent as a PDF, Legal size, in the existing thread with the RTO forms. Never sent from GHL." },
    { id: "IV-02", phase: "invoice", owner: "intake", from: 2, for: "all", critical: false, ref: "SOP 08 / SOP 09",
      text: "Current form set sent (2.2 or 2.4). RPL Inv - Sent? and RTO - Forms Sent? set to Yes on the day they went out." },
    { id: "IV-03", phase: "invoice", owner: "drafting", from: 2, for: "all", critical: true, ref: "SOP 08 / SOP 14",
      text: "Payment followed up at the cadence. RPL Inv - Received updated only on Accounts' bank confirmation, never from a receipt image, and the amount recorded at the same time." },
    { id: "IV-04", phase: "invoice", owner: "review", from: 2, for: "all", critical: true, ref: "SOP 09",
      text: "Signed forms chased at the cadence, checked complete, signature and details match the ID documents, filed before submission." },

    // ---- On Hold (only while the file is on hold) --------------------------
    { id: "HO-01", phase: "hold", owner: "lead", from: 2, only: ["C"], for: "all", critical: true, ref: "SOP 12",
      text: "Dated note with the reason added every time the file went on hold, and the file reviewed at least weekly." },
    { id: "HO-02", phase: "hold", owner: "lead", from: 2, only: ["C"], for: "all", critical: false, ref: "SOP 12",
      text: "Not on hold beyond 10 business days without a go/no-go decision from the Admin Lead (resume or cancel)." },

    // ---- Submission and RTO -----------------------------------------------
    { id: "SU-01", phase: "submission", owner: { noncompliant: "lead", compliant: "review" }, from: 4, for: "all", critical: true, ref: "SOP 10",
      text: "Submission gate honoured: checklist complete, Missing Documents cleared, signed forms filed, payment confirmed by Accounts, or a risk-assessed exception note on the opportunity." },
    { id: "SU-02", phase: "submission", owner: { noncompliant: "lead", compliant: "review" }, from: 4, for: "all", critical: true, ref: "SOP 10",
      text: "Submitted to the correct RTO or RTO agent (Process To) in the thread with template 4.0. Stage moved to Portfolio Sent to College and a dated submission note added." },
    { id: "SU-03", phase: "submission", owner: "review", from: 4, for: "compliant", critical: true, ref: "college process",
      text: "Submission done the way this college requires (portal, form set, kit, RTO agent, timing). See the college notes." },
    { id: "SU-04", phase: "submission", owner: "lead", from: 4, for: "all", critical: true, ref: "SOP 10",
      text: "RTO invoice requested and verified against the cost list before it went to the CEO for payment. RTO Invoice Received and RTO Paid updated the day they changed. Receipt emailed to the RTO." },
    { id: "SU-05", phase: "submission", owner: "review", from: 4, for: "all", critical: false, ref: "SOP 10 / SOP 14",
      text: "RTO followed up for status after 5 business days in the RTO's thread. Evidence requests from the RTO handled through the agent, rejections noted on the opportunity." },

    // ---- Soft copy ----------------------------------------------------------
    { id: "SC-01", phase: "softcopy", owner: "review", from: 5, for: "all", critical: true, ref: "SOP 11",
      text: "Soft copy: all four checks (name, qualification code and title, issue date, RTO name and code) passed and noted before anything left ATSR." },
    { id: "SC-02", phase: "softcopy", owner: "review", from: 5, for: "all", critical: false, ref: "SOP 11",
      text: "Soft copy attached to the opportunity, filed in the Soft Copy Database with the standard name, stage Soft Copy Received, status Won confirmed, template 3.1 sent in the applicant's thread." },
    { id: "SC-03", phase: "softcopy", owner: "intake", from: 5, for: "all", critical: false, ref: "SOP 11",
      text: "Same notice posted in the agent's WhatsApp group, and Soft Copy Distributed ticked only after both channels went out." },

    // ---- Hard copy and posting ---------------------------------------------
    { id: "PO-01", phase: "posting", owner: "posting", from: 6, for: "all", critical: false, ref: "SOP 11",
      text: "Hard copy requested with 4.3 if late, and checked against the verified soft copy before posting." },
    { id: "PO-02", phase: "posting", owner: "posting", from: 6, for: "all", critical: false, ref: "SOP 11 / Appendix A",
      text: "Posted in the week the soft copy arrived. Postage date and tracking reference recorded in the opportunity notes. Stage Posted, status Won." },
  ],
};
