/*
  Builds the audit PDF. Uses jsPDF + jspdf-autotable (loaded from cdnjs in index.html).
  buildAuditPdf(audit, jsPDF, logoDataUrl) returns a jsPDF document; the caller saves it.
*/

const PDF_COLORS = {
  teal: [13, 75, 63], turquoise: [39, 234, 166], mint: [232, 245, 238],
  charcoal: [35, 36, 40], grey: [110, 112, 116], red: [179, 38, 30], amber: [183, 121, 31],
};

function buildAuditPdf(audit, jsPDFCtor, logoDataUrl) {
  const doc = new jsPDFCtor({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16, C = PDF_COLORS;
  const stage = CRITERIA.stages.find(s => s.letter === audit.stage);
  const fmt = (iso) => iso ? iso.split("-").reverse().join("/") : "-";
  const colorFor = (s) => s.criticalFail ? C.red : s.outcome === "Pass" ? C.teal : s.outcome === "Needs coaching" ? C.amber : C.red;
  const pctTxt = (x) => x === null || x === undefined ? "-" : Math.round(x * 100) + "%";

  // header band
  doc.setFillColor(...C.teal); doc.rect(0, 0, W, 26, "F");
  if (logoDataUrl) { doc.setFillColor(255, 255, 255); doc.roundedRect(M, 5, 32, 16, 1.5, 1.5, "F"); doc.addImage(logoDataUrl, "PNG", M + 2, 6.5, 28, 10); }
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("B2B QA Audit", W - M, 12, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(({ completed: "Completed file", ongoing: "Ongoing file", cancelled: "Cancelled file" }[audit.auditType] || "File") + "  |  checks v" + audit.criteriaVersion, W - M, 18, { align: "right" });

  // title
  let y = 38;
  doc.setTextColor(...C.teal); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
  doc.text(audit.fileRef || "Audit", M, y, { maxWidth: W - 2 * M });
  doc.setDrawColor(...C.turquoise); doc.setLineWidth(1); doc.line(M, y + 3, M + 40, y + 3);

  // meta, two columns
  y += 12;
  doc.setFontSize(9); doc.setTextColor(...C.charcoal);
  const meta = [
    [audit.auditType === "cancelled" ? "Cancelled after" : "Stage at audit", stage ? stage.name : audit.stage, "Audit date", fmt(audit.date)],
    ["RTO", (audit.rto || "-") + (audit.rtoCode ? " (" + audit.rtoCode + ")" : ""), "File received", fmt(audit.receivedDate) + (audit.daysInPipeline !== null && audit.daysInPipeline !== undefined ? "  (" + audit.daysInPipeline + " days to audit)" : "")],
    ["Compliance", (audit.complianceLevel ? audit.complianceLevel + ", " : "") + (audit.compliant ? "college-specific process" : "generic checklist"), "Process To", audit.processTo || "-"],
    ["Qualification", audit.qualification || "-", "Auditor", audit.auditor || "-"],
    ["Audit ID", audit.id, "", ""],
  ];
  meta.forEach(row => {
    doc.setFont("helvetica", "bold"); doc.text(row[0], M, y);
    doc.setFont("helvetica", "normal");
    const left = doc.splitTextToSize(String(row[1]), 66); doc.text(left, M + 28, y);
    let lines = left.length;
    if (row[2]) { doc.setFont("helvetica", "bold"); doc.text(row[2], M + 100, y); doc.setFont("helvetica", "normal"); const right = doc.splitTextToSize(String(row[3]), W - M - (M + 124)); doc.text(right, M + 124, y); lines = Math.max(lines, right.length); }
    y += 4 + 4 * lines;
  });

  // result block
  y += 3;
  const s = audit.summary; const oc = colorFor(s);
  doc.setFillColor(...C.mint); doc.roundedRect(M, y, W - 2 * M, 24, 2, 2, "F");
  doc.setFillColor(...oc); doc.rect(M, y, 3, 24, "F");
  doc.setTextColor(...C.charcoal); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
  doc.text(pctTxt(s.score), M + 10, y + 15);
  doc.setFontSize(12); doc.setTextColor(...oc);
  doc.text(s.outcome.toUpperCase() + (s.criticalFail ? "  (critical check failed)" : ""), M + 42, y + 10);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.grey);
  doc.text("Passed " + s.passed + "   Failed " + s.failed + "   N/A " + s.na + "   |   Score = Pass / (Pass + Fail). One critical Fail fails the audit.", M + 42, y + 18);
  y += 30;

  // per person
  doc.autoTable({
    startY: y, margin: { left: M, right: M },
    head: [["Person", "Part of the file", "Pass", "Fail", "N/A", "Score", "Outcome"]],
    body: s.byPerson.map(p => [p.name, p.slots.join(", "), p.passed, p.failed, p.na, pctTxt(p.score), p.outcome + (p.criticalFail ? " (critical)" : "")]),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2, textColor: C.charcoal, lineColor: [220, 224, 222], lineWidth: 0.2 },
    headStyles: { fillColor: C.teal, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 42, fontStyle: "bold" }, 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center", fontStyle: "bold" } },
    didParseCell: (d) => { if (d.section === "body" && d.column.index === 6) d.cell.styles.textColor = colorFor(s.byPerson[d.row.index]); },
  });
  y = doc.lastAutoTable.finalY + 8;

  // findings, grouped by phase
  const body = []; let lastPhase = null, n = 0;
  audit.itemIds.forEach(id => {
    const it = CRITERIA.items.find(i => i.id === id); if (!it) return;
    const r = audit.results[id] || {};
    if (it.phase !== lastPhase) { const ph = CRITERIA.phases.find(p => p.id === it.phase); body.push([{ content: ph.title + "  (" + ph.sop + ")", colSpan: 6, styles: { fillColor: C.mint, fontStyle: "bold", textColor: C.teal } }]); lastPhase = it.phase; }
    n++;
    const slot = CRITERIA.slots.find(x => x.id === r.owner);
    const who = (slot ? slot.label : "") + (audit.peopleNames && audit.peopleNames[r.owner] ? "\n" + audit.peopleNames[r.owner] : "");
    body.push([String(n), it.text, who, it.critical ? "Critical" : "Standard", r.result === "pass" ? "Pass" : r.result === "fail" ? "Fail" : r.result === "na" ? "N/A" : "-", r.note || ""]);
  });
  doc.autoTable({
    startY: y, margin: { left: M, right: M },
    head: [["#", "Check", "Answerable", "Weight", "Result", "Notes / evidence"]],
    body,
    styles: { font: "helvetica", fontSize: 7.8, cellPadding: 1.8, textColor: C.charcoal, valign: "top", lineColor: [220, 224, 222], lineWidth: 0.2 },
    headStyles: { fillColor: C.teal, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 70 }, 2: { cellWidth: 26 }, 3: { cellWidth: 15, halign: "center" }, 4: { cellWidth: 13, halign: "center", fontStyle: "bold" }, 5: { cellWidth: "auto" } },
    didParseCell: (d) => {
      if (d.section !== "body" || d.cell.colSpan > 1) return;
      if (d.column.index === 3 && d.cell.raw === "Critical") d.cell.styles.textColor = C.red;
      if (d.column.index === 4) d.cell.styles.textColor = d.cell.raw === "Fail" ? C.red : d.cell.raw === "Pass" ? C.teal : C.grey;
    },
  });
  y = doc.lastAutoTable.finalY + 8;

  // coaching
  if (y > H - 40) { doc.addPage(); y = 20; }
  doc.setTextColor(...C.teal); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("Coaching note / agreed action", M, y); y += 5;
  doc.setTextColor(...C.charcoal); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(doc.splitTextToSize(audit.coaching && audit.coaching.trim() ? audit.coaching : "None recorded.", W - 2 * M), M, y);

  // footer
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(...C.grey); doc.setFont("helvetica", "normal");
    doc.text("ATSR  |  Internal - Confidential  |  " + CRITERIA.manual, M, H - 8);
    doc.text("Page " + p + " of " + pages, W - M, H - 8, { align: "right" });
  }
  return doc;
}

function auditPdfFilename(audit) {
  const safe = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return "QA_" + safe(audit.fileRef || audit.id) + "_" + audit.date + "_" + audit.auditType + ".pdf";
}

if (typeof module !== "undefined") module.exports = { buildAuditPdf, auditPdfFilename };
