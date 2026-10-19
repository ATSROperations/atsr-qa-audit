/*
  PDF export. Uses jsPDF + jspdf-autotable (loaded from cdnjs in index.html).
    buildAuditPdf(audit, jsPDF, logo)             the full file audit, every part and every person
    buildPersonPdf(audit, memberId, jsPDF, logo)  one person's copy: only their checks and score,
                                                  with the file outcome stated neutrally
*/

const PDF_COLORS = {
  teal: [13, 75, 63], turquoise: [39, 234, 166], mint: [232, 245, 238],
  charcoal: [35, 36, 40], grey: [110, 112, 116], red: [179, 38, 30], amber: [183, 121, 31],
};
const PDF_M = 16;
const pdfFmt = (iso) => iso ? iso.split("-").reverse().join("/") : "-";
const pdfPct = (x) => x === null || x === undefined ? "-" : Math.round(x * 100) + "%";
const pdfColorFor = (s) => s.criticalFail ? PDF_COLORS.red : s.outcome === "Pass" ? PDF_COLORS.teal : s.outcome === "Needs coaching" ? PDF_COLORS.amber : PDF_COLORS.red;
const pdfTypeLabel = (a) => ({ completed: "Completed file", ongoing: "Ongoing file", cancelled: "Cancelled file" }[a.auditType] || "File");
const pdfResult = (r) => r === "pass" ? "Pass" : r === "fail" ? "Fail" : r === "na" ? "N/A" : "-";

function pdfStart(jsPDFCtor, logoDataUrl, rightTitle, rightSub) {
  const doc = new jsPDFCtor({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = PDF_M, C = PDF_COLORS;
  const watermark = () => { if (typeof ATSR_TICK_MINT !== "undefined") doc.addImage(ATSR_TICK_MINT, "PNG", W - M - 78, H - 78, 78, 57); };
  watermark();
  if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", M, 9, 45, 12);
  doc.setTextColor(...C.teal); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(rightTitle, W - M, 14, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...C.grey);
  doc.text(rightSub, W - M, 19.5, { align: "right" });
  doc.setDrawColor(...C.teal); doc.setLineWidth(0.5); doc.line(M, 26, W - M, 26);
  doc.setDrawColor(...C.turquoise); doc.setLineWidth(1.4); doc.line(M, 26, M + 28, 26);
  return { doc, W, H, M, C, watermark };
}
function pdfFinish(ctx, footerLeft) {
  const { doc, W, H, M, C } = ctx;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(...C.grey); doc.setFont("helvetica", "normal");
    doc.text(footerLeft, M, H - 8);
    doc.text("Page " + p + " of " + pages, W - M, H - 8, { align: "right" });
  }
  return doc;
}
function pdfMeta(ctx, y, rows) {
  const { doc, W, M, C } = ctx;
  doc.setFontSize(9); doc.setTextColor(...C.charcoal);
  rows.forEach(row => {
    doc.setFont("helvetica", "bold"); doc.text(row[0], M, y);
    doc.setFont("helvetica", "normal");
    const left = doc.splitTextToSize(String(row[1]), 66); doc.text(left, M + 28, y);
    let lines = left.length;
    if (row[2]) { doc.setFont("helvetica", "bold"); doc.text(row[2], M + 100, y); doc.setFont("helvetica", "normal"); const right = doc.splitTextToSize(String(row[3]), W - M - (M + 124)); doc.text(right, M + 124, y); lines = Math.max(lines, right.length); }
    y += 4 + 4 * lines;
  });
  return y;
}
function pdfScoreBlock(ctx, y, s, caption) {
  const { doc, W, M, C } = ctx; const oc = pdfColorFor(s);
  doc.setFillColor(...C.mint); doc.roundedRect(M, y, W - 2 * M, 24, 2, 2, "F");
  doc.setFillColor(...oc); doc.rect(M, y, 3, 24, "F");
  doc.setTextColor(...C.charcoal); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
  doc.text(pdfPct(s.score), M + 10, y + 15);
  doc.setFontSize(12); doc.setTextColor(...oc);
  doc.text(s.outcome.toUpperCase() + (s.criticalFail ? "  (critical check failed)" : ""), M + 42, y + 10);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.grey);
  doc.text(caption, M + 42, y + 18);
  return y + 30;
}
function pdfFindings(ctx, y, audit, itemIds, withOwner) {
  const { doc, M, C, watermark } = ctx;
  const body = []; let lastPhase = null, n = 0;
  itemIds.forEach(id => {
    const it = CRITERIA.items.find(i => i.id === id); if (!it) return;
    const r = audit.results[id] || {};
    if (it.phase !== lastPhase) { const ph = CRITERIA.phases.find(p => p.id === it.phase); body.push([{ content: ph.title + "  (" + ph.sop + ")", colSpan: withOwner ? 6 : 5, styles: { fillColor: C.mint, fontStyle: "bold", textColor: C.teal } }]); lastPhase = it.phase; }
    n++;
    const row = [String(n), it.text];
    if (withOwner) { const slot = CRITERIA.slots.find(x => x.id === r.owner); row.push((slot ? slot.label : "") + (audit.peopleNames && audit.peopleNames[r.owner] ? "\n" + audit.peopleNames[r.owner] : "")); }
    row.push(it.critical ? "Critical" : "Standard", pdfResult(r.result), r.note || "");
    body.push(row);
  });
  const head = withOwner ? ["#", "Check", "Answerable", "Weight", "Result", "Notes / evidence"] : ["#", "Check", "Weight", "Result", "Notes / evidence"];
  const wi = withOwner ? 3 : 2, ri = withOwner ? 4 : 3;
  const columnStyles = withOwner
    ? { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 70 }, 2: { cellWidth: 26 }, 3: { cellWidth: 15, halign: "center" }, 4: { cellWidth: 13, halign: "center", fontStyle: "bold" }, 5: { cellWidth: "auto" } }
    : { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 84 }, 2: { cellWidth: 16, halign: "center" }, 3: { cellWidth: 14, halign: "center", fontStyle: "bold" }, 4: { cellWidth: "auto" } };
  doc.autoTable({
    startY: y, margin: { left: M, right: M }, theme: "grid",
    head: [head], body,
    styles: { font: "helvetica", fontSize: 7.8, cellPadding: 1.8, textColor: C.charcoal, valign: "top", lineColor: [220, 224, 222], lineWidth: 0.2 },
    headStyles: { fillColor: C.teal, textColor: 255, fontStyle: "bold" },
    willDrawPage: (d) => { if (d.pageNumber > 1) watermark(); },
    columnStyles,
    didParseCell: (d) => {
      if (d.section !== "body" || d.cell.colSpan > 1) return;
      if (d.column.index === wi && d.cell.raw === "Critical") d.cell.styles.textColor = C.red;
      if (d.column.index === ri) d.cell.styles.textColor = d.cell.raw === "Fail" ? C.red : d.cell.raw === "Pass" ? C.teal : C.grey;
    },
  });
  return doc.lastAutoTable.finalY + 8;
}
function pdfSection(ctx, y, title, text) {
  const { doc, W, H, M, C, watermark } = ctx;
  if (y > H - 40) { doc.addPage(); watermark(); y = 20; }
  doc.setTextColor(...C.teal); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(title, M, y); y += 5;
  doc.setTextColor(...C.charcoal); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  const lines = doc.splitTextToSize(text, W - 2 * M);
  doc.text(lines, M, y);
  return y + lines.length * 4 + 6;
}
function pdfFileMeta(audit) {
  const stage = CRITERIA.stages.find(s => s.letter === audit.stage);
  const rows = [
    [audit.auditType === "cancelled" ? "Cancelled after" : "Stage at audit", stage ? stage.name : audit.stage, "Audit date", pdfFmt(audit.date)],
    ["RTO", (audit.rto || "-") + (audit.rtoCode ? " (" + audit.rtoCode + ")" : ""), "File received", pdfFmt(audit.receivedDate) + (audit.daysInPipeline !== null && audit.daysInPipeline !== undefined ? "  (" + audit.daysInPipeline + " days to audit)" : "")],
    ["Compliance", (audit.complianceLevel ? audit.complianceLevel + ", " : "") + (audit.compliant ? "college-specific process" : "generic checklist"), "Process To", audit.processTo || "-"],
    ["Qualification", audit.qualification || "-", "Auditor", audit.auditor || "-"],
  ];
  if (audit.submitWait) rows.push(["Submission wait", audit.submitWait.businessDays + " business days " + audit.submitWait.label + " (allowed " + audit.submitWait.allowed + ")" + (audit.submitWait.over ? "  OVER" : ""), "Complete / sent", pdfFmt(audit.completeDate) + " / " + pdfFmt(audit.sentDate)]);
  rows.push(["Audit ID", audit.id, "", ""]);
  return rows;
}

// ---------------------------------------------------------------- full file audit
function buildAuditPdf(audit, jsPDFCtor, logoDataUrl) {
  const ctx = pdfStart(jsPDFCtor, logoDataUrl, "B2B QA Audit", pdfTypeLabel(audit) + "  |  checks v" + audit.criteriaVersion);
  const { doc, M, C } = ctx;
  let y = 38;
  doc.setTextColor(...C.teal); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
  doc.text(audit.fileRef || "Audit", M, y, { maxWidth: ctx.W - 2 * M });
  y = pdfMeta(ctx, y + 12, pdfFileMeta(audit)) + 3;
  const s = audit.summary;
  y = pdfScoreBlock(ctx, y, s, "Passed " + s.passed + "   Failed " + s.failed + "   N/A " + s.na + "   |   Score = Pass / (Pass + Fail). One critical Fail fails the audit.");
  doc.autoTable({
    startY: y, margin: { left: M, right: M }, theme: "grid",
    head: [["Person", "Part of the file", "Pass", "Fail", "N/A", "Score", "Outcome"]],
    body: s.byPerson.map(p => [p.name, p.slots.join(", "), p.passed, p.failed, p.na, pdfPct(p.score), p.outcome + (p.criticalFail ? " (critical)" : "")]),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2, textColor: C.charcoal, lineColor: [220, 224, 222], lineWidth: 0.2 },
    headStyles: { fillColor: C.teal, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 42, fontStyle: "bold" }, 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center", fontStyle: "bold" } },
    willDrawPage: (d) => { if (d.pageNumber > 1) ctx.watermark(); },
    didParseCell: (d) => { if (d.section === "body" && d.column.index === 6) d.cell.styles.textColor = pdfColorFor(s.byPerson[d.row.index]); },
  });
  y = doc.lastAutoTable.finalY + 8;
  y = pdfFindings(ctx, y, audit, audit.itemIds, true);
  y = pdfSection(ctx, y, "Coaching note / agreed action (file)", audit.coaching && audit.coaching.trim() ? audit.coaching : "None recorded.");
  const per = audit.coachingByPerson || {};
  s.byPerson.forEach(p => { if (p.memberId && per[p.memberId] && per[p.memberId].trim()) y = pdfSection(ctx, y, "Agreed actions: " + p.name, per[p.memberId]); });
  return pdfFinish(ctx, "ATSR  |  Internal - Confidential  |  " + CRITERIA.manual);
}

// ---------------------------------------------------------------- one person's copy
function buildPersonPdf(audit, memberId, jsPDFCtor, logoDataUrl) {
  const p = (audit.summary.byPerson || []).find(x => x.memberId === memberId);
  if (!p) throw new Error("That person was not part of this audit.");
  const mySlots = Object.keys(audit.people || {}).filter(k => audit.people[k] === memberId);
  const myIds = audit.itemIds.filter(id => mySlots.includes((audit.results[id] || {}).owner));
  const ctx = pdfStart(jsPDFCtor, logoDataUrl, "QA Audit Feedback", "Your part of the file  |  checks v" + audit.criteriaVersion);
  const { doc, M, C } = ctx;
  let y = 38;
  doc.setTextColor(...C.teal); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
  doc.text(p.name, M, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...C.grey);
  doc.text("Your part: " + p.slots.join(", ") + "   |   File: " + (audit.fileRef || "-"), M, y + 7);
  y = pdfMeta(ctx, y + 17, pdfFileMeta(audit).filter(r => r[0] !== "Audit ID")) + 3;

  // their result, then the file result stated neutrally
  y = pdfScoreBlock(ctx, y, p, "Your checks: passed " + p.passed + ", failed " + p.failed + ", N/A " + p.na + ". Score = Pass / (Pass + Fail).");
  const fs = audit.summary; const fc = pdfColorFor(fs);
  doc.setFillColor(248, 250, 249); doc.roundedRect(M, y, ctx.W - 2 * M, 14, 2, 2, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...C.charcoal);
  doc.text("Whole file result:", M + 5, y + 6);
  doc.setTextColor(...fc); doc.text(fs.outcome.toUpperCase(), M + 38, y + 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...C.grey);
  doc.text("The file result combines every part of the process, across everyone who handled the file. The checks below are the ones that were yours.", M + 5, y + 11);
  y += 20;

  y = pdfFindings(ctx, y, audit, myIds, false);

  const fails = myIds.filter(id => (audit.results[id] || {}).result === "fail");
  if (fails.length) {
    const text = fails.map((id, i) => { const it = CRITERIA.items.find(x => x.id === id); const r = audit.results[id] || {}; return (i + 1) + ". " + it.text + (r.note ? "\n   Finding: " + r.note : ""); }).join("\n\n");
    y = pdfSection(ctx, y, "What to work on", text);
  } else {
    y = pdfSection(ctx, y, "What to work on", "No checks on your part were failed in this audit.");
  }
  const note = (audit.coachingByPerson || {})[memberId];
  y = pdfSection(ctx, y, "Agreed actions", note && note.trim() ? note : "None recorded.");
  return pdfFinish(ctx, "ATSR  |  Internal - Confidential  |  " + CRITERIA.manual + "  |  Audit " + audit.id);
}

function auditPdfFilename(audit) {
  const safe = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return "QA_" + safe(audit.fileRef || audit.id) + "_" + audit.date + "_" + audit.auditType + ".pdf";
}
function personPdfFilename(audit, name) {
  const safe = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return "QA_" + safe(name) + "_" + safe(audit.fileRef || audit.id) + "_" + audit.date + ".pdf";
}

if (typeof module !== "undefined") module.exports = { buildAuditPdf, buildPersonPdf, auditPdfFilename, personPdfFilename };
