/*
  ATSR B2B QA audit criteria. ONE list of checks for the whole file journey.
  This is the only file to edit when the B2B Operations Manual (or the CEO's standards) change.

  An audit is of a FILE. The app shows only the checks that apply to that file:
    - from:  the earliest pipeline stage at which the check can be judged (see stages, rank)
    - only:  optional, the check appears only when the file is at one of these stages
    - cancelled: true means the check appears only on cancelled-file audits
    - for:   "all", "compliant" or "noncompliant" (the checklist track, see TRACK_BY_LEVEL
             in config.js: which compliance levels follow the college-specific process)
    - owner: which person on the file is answerable. A string, or an object keyed by
             compliance when the owner changes with the file type. The auditor can reassign
             any single check to someone else on the audit.

  Rules for editing:
    - Every check comes from the manual, the CEO's standards (Nov 2026) or, for compliant
      colleges, the college's own process. Quote the reference in "ref".
    - critical: true means one Fail on that check fails the whole audit.
    - Never reuse an id. Old audits store results by id.
    - Bump "version" whenever a check changes. It is printed on every PDF.

  Version history
    2.3 (Nov 2026)  Sections renamed and reordered as the CEO set them. CEO standards added: signatures, 2-hour replies, Description/Visa/Company
                    Name fields, invoice timing and corrections, bulk invoices, accounting notes
                    and the bookkeeper's part, prerequisites, no bank cards, compliant-college
                    forms and kit timing, receipt-to-RTO targets, RTO cadence 2 / 7 days,
                    soft copy clean-up, postal addresses. New slot: Accounts.
    2.2 (Oct 2026)  RTO follow-up 5 / 2 business days, submission wait checks.
*/

const CRITERIA = {
  version: "2.3",
  manual: "B2B Operations Manual v2.0 (ATSR-OPS-B2B-MANUAL) + CEO standards Nov 2026",
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
  // Cancelled (H) is audited against the last stage the file reached before it was
  // cancelled, plus the cancellation checks. The auditor picks that last stage.

  // Who is answerable. The audit header assigns a team member to each slot in scope.
  slots: [
    { id: "intake", label: "Intake", defaultRole: "Intake Admin" },
    { id: "drafting", label: "Drafting", defaultRole: "Drafting Admin" },
    { id: "review", label: "Review and submission", defaultRole: { noncompliant: "Drafting Admin", compliant: null } },
    { id: "lead", label: "Admin Lead", defaultRole: "Admin Lead" },
    { id: "accounts", label: "Accounts", defaultRole: "Bookkeeper" },
    { id: "posting", label: "Posting", defaultRole: "BD Manager" },
    { id: "cancel", label: "Cancellation", defaultRole: "Admin Lead" },
  ],

  // Sections, in the order the CEO set (Nov 2026). On Hold shows only while a file is on hold,
  // Cancellation only on cancelled-file audits.
  phases: [
    { id: "intake", title: "Intake and Inquiry", sop: "SOP 01, 02, 14 / CEO standards" },
    { id: "assign", title: "RTO Assignment and Initial Check", sop: "SOP 02 step 3, SOP 06 / CEO standards" },
    { id: "invoice", title: "Invoicing and Payments", sop: "SOP 08, SOP 10 / CEO standards" },
    { id: "rtodocs", title: "RTO Documents", sop: "SOP 09 / CEO standards" },
    { id: "drafting", title: "Drafting, Portfolio Review and Follow-up", sop: "SOP 03 to 07, 14 / CEO standards" },
    { id: "hold", title: "On Hold", sop: "SOP 12" },
    { id: "submission", title: "RTO Submission and Communication", sop: "SOP 10 / CEO standards" },
    { id: "softcopy", title: "Soft Copy", sop: "SOP 11 / CEO standards" },
    { id: "posting", title: "Hard Copy and Posting", sop: "SOP 11 / CEO standards" },
    { id: "cancel", title: "Cancellation", sop: "SOP 12 / CEO standards" },
  ],

  items: [
    // ---- Intake and Inquiry ------------------------------------------------------
    { id: "IN-01", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "SOP 01 / SOP 14",
      text: "File acknowledged to the agent the same day with template 1.0, in the thread the file arrived in. No new email started for an existing applicant." },
    { id: "IN-02", phase: "intake", owner: "intake", from: 1, for: "all", critical: true, ref: "SOP 02 / Rule 2 / CEO standards",
      text: "Opportunity created under the right sub-agent contact the first time (not moved later), one per applicant per qualification. No person-contact created for the applicant." },
    { id: "IN-03", phase: "intake", owner: "intake", from: 1, for: "all", critical: true, ref: "SOP 02",
      text: "Opportunity name matches the passport character for character." },
    { id: "IN-04", phase: "intake", owner: "intake", from: 1, for: "all", critical: true, ref: "SOP 02 / Rule 3 / Rule 6 / CEO standards",
      text: "Lead Source chosen from the dropdown and checked, standard Source field untouched, auto fields not typed by hand. Automations confirmed after save and refresh; any miss reported the same day." },
    { id: "IN-05", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "SOP 02 / CEO standards",
      text: "Description custom field filled in properly: the sub-agent's notes and special instructions are in it, word for word where it matters. Fields filled in the manual's order (qualification, compliant?, SOA)." },
    { id: "IN-06", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "CEO standards",
      text: "Current Visa field filled in from the documents received (and Previous Visa where there was one). Not left blank for an onshore applicant." },
    { id: "IN-07", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "CEO standards",
      text: "Company Name field matches the sub-agent contact's company name exactly. One spelling per company across GHL, no second variant created." },
    { id: "IN-08", phase: "intake", owner: "lead", from: 1, for: "all", critical: false, ref: "CEO standards",
      text: "The sub-agent contact this opportunity sits under carries the correct tags." },
    { id: "IN-09", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "CEO standards / SOP 14",
      text: "No email on this file left unattended: every enquiry from the agent or applicant answered within 2 hours of receipt (an acknowledgement counts), in the existing thread." },
    { id: "IN-10", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "CEO standards",
      text: "Every email sent from the shared admin@ inbox on this file carries the sender's own signature, so the agent knows who they are dealing with." },
    { id: "IN-11", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "CEO standards / Rule 3",
      text: "Information entered in the GHL field made for it (Description, Missing Documents, visa, USI/passport, invoice fields, Accounting Notes), not in the wrong field or only in a note." },
    { id: "IN-12", phase: "intake", owner: "intake", from: 1, for: "all", critical: false, ref: "CEO standards",
      text: "Unusual, irregular or urgent enquiries on this file forwarded to the right person the same day (Admin Lead, BD Manager or CEO), and any specific request or requirement from the agent passed to the Admin Lead." },

    // ---- RTO Assignment and Initial Check ----------------------------------------
    { id: "AS-01", phase: "assign", owner: "lead", from: 1, for: "all", critical: true, ref: "SOP 02 step 3 / SOP 08 / CEO standards",
      text: "Correct RTO chosen for the qualification and the applicant's situation. RTO, Compliance Level, Process To and RPL Inv - Amount set by the Admin Lead before drafting or invoicing started. Amount taken from the price list for the applicant's visa category, not estimated." },
    { id: "AS-02", phase: "assign", owner: "intake", from: 1, for: "all", critical: false, ref: "CEO standards / SOP 07",
      text: "Initial check done on receipt: documents received counted against the checklist for this RTO, and the Missing Documents field set on day one so the first request to the agent is complete." },
    { id: "DR-05", phase: "assign", owner: "drafting", from: 2, for: "all", critical: false, ref: "SOP 06 / CEO standards",
      text: "Visa checked against Appendix E for onshore non-citizens, the visa copy obtained where it is required and the visa recorded in GHL. No visa copy chased where it is not required." },

    // ---- Invoicing and Payments --------------------------------------------------
    { id: "IV-01", phase: "invoice", owner: "intake", from: 2, for: "all", critical: true, ref: "SOP 08 / CEO standards",
      text: "Invoice draft created only after the amount was set, and the amount encoded is correct for the applicant's visa category. Named Opportunity Name_Invoice Number. Sent as a PDF, Legal size, in the existing thread with the RTO forms. Never sent from GHL." },
    { id: "IV-05", phase: "invoice", owner: "intake", from: 2, for: "all", critical: false, ref: "CEO standards",
      text: "Invoice sent within 6 working hours of the RTO and amount being assigned." },
    { id: "IV-06", phase: "invoice", owner: "intake", from: 2, for: "all", critical: false, ref: "CEO standards",
      text: "Any invoice correction made by editing the original invoice and re-sending it under the same invoice number. No second invoice raised for the same file." },
    { id: "IV-07", phase: "invoice", owner: "intake", from: 2, for: "all", critical: false, ref: "CEO standards",
      text: "Invoice sent to the address this agent asked invoices to go to (some agents use a separate accounts email), not only to the thread." },
    { id: "IV-08", phase: "invoice", owner: "intake", from: 2, for: "all", critical: false, ref: "CEO standards",
      text: "Where the agent is on weekly or bulk invoicing, this file's line is correct: amount, qualification code and name, and the applicant's (opportunity) name in the description." },
    { id: "IV-03", phase: "invoice", owner: "drafting", from: 2, for: "all", critical: true, ref: "SOP 08 / SOP 14 / CEO standards",
      text: "Every due payment, individual or bulk invoice, followed up weekly. RPL Inv - Received updated only on Accounts' bank confirmation, never from a receipt image, and the amount recorded at the same time." },
    { id: "IV-09", phase: "invoice", owner: "accounts", from: 2, for: "all", critical: false, ref: "CEO standards",
      text: "Accounting Notes field keeps a proper record of this file's money: invoice number, payment received and date, any partial payment, credit or refund, with the reason." },
    { id: "IV-10", phase: "invoice", owner: "accounts", from: 2, for: "all", critical: false, ref: "CEO standards",
      text: "Any accounting discrepancy on this file resolved the same day it was found, or a note with the evidence left in Accounting Notes for the CEO to sort as soon as possible." },
    { id: "SU-04", phase: "invoice", owner: "lead", from: 4, for: "all", critical: true, ref: "SOP 10 / CEO standards",
      text: "RTO invoice requested, checked against the cost list, and accepted only in the correct form: addressed to our company with our ABN and a proper invoice number. Passed to payables (Accounts) promptly. RTO Invoice Received updated the day it arrived." },
    { id: "IV-11", phase: "invoice", owner: "accounts", from: 4, for: "all", critical: true, ref: "SOP 10 / CEO standards",
      text: "RTO invoice paid on time once approved by the CEO, RTO Paid updated the day it changed, and the receipt emailed to the RTO." },

    // ---- RTO Documents -----------------------------------------------------------
    { id: "RD-04", phase: "rtodocs", owner: "intake", from: 2, for: "all", critical: false, ref: "CEO standards / SOP 09",
      text: "The right documents for the chosen RTO sent to the client: this RTO's checklist and form set for compliant colleges, the generic set otherwise. Nothing from another RTO sent by mistake." },
    { id: "IV-02", phase: "rtodocs", owner: "intake", from: 2, for: "all", critical: false, ref: "SOP 08 / SOP 09 / CEO standards",
      text: "The right enrolment form, LLN form and RPL kit for this RTO and qualification sent (current set, 2.2 or 2.4). RPL Inv - Sent? and RTO - Forms Sent? set to Yes on the day they went out." },
    { id: "RD-01", phase: "rtodocs", owner: "intake", from: 2, for: "noncompliant", critical: false, ref: "CEO standards",
      text: "Generic file: enrolment form, LLN form and RPL kit sent blank (the applicant fills them in and signs), and followed up regularly until they come back." },
    { id: "RD-02", phase: "rtodocs", owner: "review", from: 2, for: "compliant", critical: false, ref: "CEO standards / college process",
      text: "Compliant college: enrolment form and RPL kit pre-filled by ATSR and sent to the client for signing." },
    { id: "RD-03", phase: "rtodocs", owner: "review", from: 2, for: "compliant", critical: false, ref: "CEO standards / college process",
      text: "Compliant college: forms sent within 2 days of opportunity creation and the RPL kit within 10 days (see the days in the file facts)." },
    { id: "IV-04", phase: "rtodocs", owner: "review", from: 2, for: "all", critical: true, ref: "SOP 09",
      text: "Signed forms chased at the cadence, checked complete, signature and details match the ID documents, filed before submission." },
    { id: "RD-05", phase: "rtodocs", owner: "review", from: 4, for: "noncompliant", critical: false, ref: "CEO standards",
      text: "Where this less or non-compliant college requires signed enrolment forms, they went to the RTO on time with the portfolio." },

    // ---- Drafting, Portfolio Review and Follow-up --------------------------------
    { id: "DR-01", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: false, ref: "SOP 03 / CEO standards",
      text: "Drive folder at Applications > Month-Year > Applicant Name_Qualification with all nine numbered sub-folders. Every document the applicant or agent sent downloaded, counted, renamed and filed in the right sub-folder. No loose files, duplicates or IMG_xxxx names." },
    { id: "DR-02", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "SOP 03 / Rule 4",
      text: "Unique identifier recorded on the opportunity: USI for onshore, passport number for offshore." },
    { id: "DR-03", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "SOP 04 / CEO standards",
      text: "ID documents usable (legible, four corners visible, current where required) and totalling 100 points, or the shortfall recorded as points still needed, not as a document name. A bank card never counted as ID." },
    { id: "DR-04", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "SOP 05",
      text: "USI is 10 characters, name matches the passport, VET transcript filed. Any existing qualification in the same field reported." },
    { id: "DR-06", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "Rule 7",
      text: "Personal information protected: ID documents stayed in the applicant's Drive folder. Surname, date of birth and ID numbers blurred in any screenshot, training material or chat." },
    { id: "DR-07", phase: "drafting", owner: "drafting", from: 2, for: "all", critical: true, ref: "CEO standards / checklist prerequisites",
      text: "Where the qualification has a prerequisite (Prerequisite field on the opportunity, asterisked on the checklist), evidence that it is met was collected and filed. The file not treated as complete without it." },
    { id: "RV-01", phase: "drafting", owner: "review", from: 2, for: "noncompliant", critical: true, ref: "SOP 07 / ATSR practice",
      text: "Portfolio checked against the generic checklist and the bare minimum is in place: 100-point ID, USI or passport number, work evidence. Documents not scrutinised beyond that." },
    { id: "RV-02", phase: "drafting", owner: "review", from: 2, for: "compliant", critical: true, ref: "SOP 07 / college process",
      text: "Portfolio checked against this college's own checklist for this qualification, and the college's specific rules for this file followed (see the college notes shown above the checklist)." },
    { id: "RV-03", phase: "drafting", owner: "review", from: 2, for: "all", critical: true, ref: "SOP 07 / Rule 5 / CEO standards",
      text: "Missing Documents field accurate: the right items ticked, nothing irrelevant, cleared the same day items arrive and before the stage moved to Portfolio Sent to College." },
    { id: "RV-04", phase: "drafting", owner: "review", from: 2, for: "all", critical: true, ref: "SOP 07 / Appendix A",
      text: "Stage matches reality: Incomplete Portfolio while anything is missing, Complete Portfolio only when nothing is." },
    { id: "RV-05", phase: "drafting", owner: "review", from: 2, for: "all", critical: false, ref: "SOP 07 / SOP 14 / CEO standards",
      text: "Missing-documents request (2.1) sent in the existing thread, lists the specific items still missing and nothing wrong or irrelevant (not already received, not required by this RTO). Follow-ups at the cadence for this file type (see the cadence above the checklist). Last File Update set every time." },
    { id: "RV-09", phase: "drafting", owner: "review", from: 2, for: "all", critical: false, ref: "CEO standards",
      text: "Missing documents asked for in one email (two at most) the first time, not drip-fed over several. Generic files: bare minimum only, communication kept short and straightforward, aiming to have the file complete within 2 days of receipt." },
    { id: "RV-06", phase: "drafting", owner: "review", from: 2, for: "all", critical: false, ref: "SOP 07 / CEO standards",
      text: "File with no movement for more than 5 days escalated to the BD Manager and the escalation logged on the opportunity." },
    { id: "RV-07", phase: "drafting", owner: "review", from: 2, for: "all", critical: false, ref: "CEO standards",
      text: "Everything that arrived later by email or WhatsApp filed in the right sub-folder, and the GHL fields updated with what it told us: USI or passport number, Missing Documents, Current and Previous Visa." },
    { id: "RV-08", phase: "drafting", owner: "review", from: 2, for: "compliant", critical: false, ref: "CEO standards / college process",
      text: "Compliant college: the applicant guided to the evidence the college needs. Where a document does not exist, an alternative from the college's accepted options suggested, so the file keeps moving." },

    // ---- On Hold (only while the file is on hold) --------------------------------
    { id: "HO-01", phase: "hold", owner: "lead", from: 2, only: ["C"], for: "all", critical: true, ref: "SOP 12",
      text: "Dated note with the reason added every time the file went on hold, and the file reviewed at least weekly." },
    { id: "HO-02", phase: "hold", owner: "lead", from: 2, only: ["C"], for: "all", critical: false, ref: "SOP 12",
      text: "Not on hold beyond 10 business days without a go/no-go decision from the Admin Lead (resume or cancel)." },

    // ---- RTO Submission and Communication ----------------------------------------
    { id: "SU-01", phase: "submission", owner: { noncompliant: "lead", compliant: "review" }, from: 4, for: "all", critical: true, ref: "SOP 10",
      text: "Submission gate honoured: checklist complete, Missing Documents cleared, signed forms filed, payment confirmed by Accounts, or a risk-assessed exception note on the opportunity." },
    { id: "SU-02", phase: "submission", owner: { noncompliant: "lead", compliant: "review" }, from: 4, for: "all", critical: true, ref: "SOP 10 / CEO standards",
      text: "The correct portfolio submitted to the correct RTO or RTO agent (Process To), in the thread with template 4.0, with the right portfolio folder links attached and every detail correct. Stage moved to Portfolio Sent to College and a dated submission note added." },
    { id: "SU-03", phase: "submission", owner: "review", from: 4, for: "compliant", critical: true, ref: "college process",
      text: "Submission done the way this college requires (portal, form set, kit, RTO agent, timing). See the college notes." },
    { id: "SU-05", phase: "submission", owner: "review", from: 4, for: "all", critical: false, ref: "SOP 10 / SOP 14 / CEO standards",
      text: "RTO followed up for status in the RTO's thread at the cadence for this college type: every 2 days for less and non-compliant RTOs, every 7 days for compliant RTOs, pushing for the soft copy on time. Evidence requests from the RTO handled through the agent, rejections noted on the opportunity." },
    { id: "SU-06", phase: "submission", owner: { noncompliant: "lead", compliant: "review" }, from: 4, for: "all", critical: false, ref: "SOP 10 / CEO standards",
      text: "Submitted to the RTO within one business day of the portfolio being complete and paid (see the days in the file facts). Where it waited longer, a note on the opportunity says why (payment, forms, exception)." },
    { id: "CP-01", phase: "submission", owner: { noncompliant: "lead", compliant: "review" }, from: 3, only: ["D"], for: "all", critical: false, ref: "SOP 10 / CEO standards",
      text: "Portfolio has not been sitting at Complete Portfolio beyond one business day (see the days in the file facts), or the reason it has not gone to the RTO yet is noted on the opportunity (payment, forms, exception)." },
    { id: "SU-07", phase: "submission", owner: { noncompliant: "lead", compliant: "review" }, from: 4, for: "all", critical: false, ref: "CEO standards",
      text: "Receipt to RTO within the target for this file type: 2 days for less and non-compliant colleges, 2 weeks for compliant colleges (see the days in the file facts). Where it took longer, the reason is on the opportunity." },
    { id: "SU-09", phase: "submission", owner: "lead", from: 4, for: "all", critical: false, ref: "CEO standards",
      text: "RTO emails and requests on this file answered by the right person (Admin Lead; BD Manager for urgent matters) within 2 hours and acted on." },
    { id: "SU-10", phase: "submission", owner: "lead", from: 1, for: "all", critical: false, ref: "CEO standards",
      text: "Urgent requests by email or WhatsApp handled with the right etiquette: acknowledged promptly, answered on time, and anything out of the ordinary escalated to the BD Manager so the sub-agent hears it from the right person." },

    // ---- Soft Copy ---------------------------------------------------------------
    { id: "SC-01", phase: "softcopy", owner: "review", from: 5, for: "all", critical: true, ref: "SOP 11 / CEO standards",
      text: "Soft copy properly checked before anything left ATSR: all four checks (name, qualification code and title, issue date, RTO name and code) passed and noted." },
    { id: "SC-02", phase: "softcopy", owner: "review", from: 5, for: "all", critical: false, ref: "SOP 11",
      text: "Soft copy attached to the opportunity, filed in the Soft Copy Database with the standard name, stage Soft Copy Received, status Won confirmed, template 3.1 sent in the applicant's thread." },
    { id: "SC-03", phase: "softcopy", owner: "intake", from: 5, for: "all", critical: false, ref: "SOP 11",
      text: "Same notice posted in the agent's WhatsApp group, and Soft Copy Distributed ticked only after both channels went out." },
    { id: "SC-04", phase: "softcopy", owner: "review", from: 6, for: "all", critical: false, ref: "CEO standards",
      text: "Soft copy deleted from the Drive folder once it is a month old. Only the Soft Copy Database copy kept." },

    // ---- Hard Copy and Posting ---------------------------------------------------
    { id: "PO-01", phase: "posting", owner: "posting", from: 6, for: "all", critical: false, ref: "SOP 11",
      text: "Hard copy requested with 4.3 if late, and checked against the verified soft copy before posting." },
    { id: "PO-02", phase: "posting", owner: "posting", from: 6, for: "all", critical: false, ref: "SOP 11 / Appendix A / CEO standards",
      text: "Posted on time: in the week the soft copy arrived, and never later than a month after it. Postage date and tracking reference recorded in the opportunity notes. Stage Posted, status Won." },
    { id: "PO-03", phase: "posting", owner: "intake", from: 5, for: "all", critical: false, ref: "CEO standards",
      text: "Postal address received by email or WhatsApp forwarded to the postal group the same day." },

    // ---- Cancellation (cancelled-file audits only) -------------------------------
    { id: "CX-01", phase: "cancel", owner: "cancel", from: 1, cancelled: true, for: "all", critical: true, ref: "SOP 12 / Appendix A",
      text: "Lost Reason selected before the stage moved to Cancelled, and the status confirmed afterwards: Lost when the client walked away, Abandoned when ATSR declined." },
    { id: "CX-02", phase: "cancel", owner: "cancel", from: 1, cancelled: true, for: "all", critical: false, ref: "SOP 12",
      text: "Dated note on the opportunity explaining the reason in plain words." },
    { id: "CX-03", phase: "cancel", owner: "cancel", from: 1, cancelled: true, for: "all", critical: false, ref: "SOP 12 / SOP 14",
      text: "Agent told in writing, in the existing thread." },
    { id: "CX-04", phase: "cancel", owner: "cancel", from: 1, cancelled: true, for: "all", critical: true, ref: "SOP 12 / CEO standards",
      text: "Money accounted for where the file was paid: refund decided by the CEO, the refund screenshot attached in the Proof of Refund to Customer/Sub-Agent field in the accounting details, and Accounting Notes explaining it. Or a note where funds are kept for re-lodging." },
    { id: "CX-05", phase: "cancel", owner: "cancel", from: 1, cancelled: true, for: "all", critical: false, ref: "SOP 12",
      text: "Right call between cancel and re-lodge: a change of RTO only keeps the opportunity and updates RTO, Compliance Level and Process To; a change of qualification cancels (Lost Reason: changed qualification) and a new opportunity is created." },
    { id: "CX-06", phase: "cancel", owner: "cancel", from: 1, cancelled: true, for: "all", critical: false, ref: "SOP 12 / SOP 10",
      text: "Where the RTO initiated the cancellation, or the agent disputed it or the refund amount, it was escalated (Admin Lead > BD Manager > CEO)." },
    { id: "CX-07", phase: "cancel", owner: "accounts", from: 1, cancelled: true, for: "all", critical: true, ref: "CEO standards",
      text: "Where a refund was due, the bookkeeper confirmed it reached the sub-agent or applicant, and the amount is recorded in the accounting details and in the books." },
  ],
};
