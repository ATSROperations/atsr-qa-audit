/* ATSR B2B QA Audit - app logic. Vanilla JS, hash routing, no build step. */

(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const uid = (prefix) => prefix + "-" + today().replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6);
  const pct = (x) => x === null || x === undefined ? "-" : Math.round(x * 100) + "%";
  const fmtDate = (iso) => { if (!iso) return "-"; const [y, m, d] = iso.split("-"); return d + "/" + m + "/" + y; };
  const daysBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;
  // Mon to Fri between two dates, excluding the start day. Public holidays are not known to the app.
  const businessDays = (a, b) => {
    if (!a || !b) return null;
    let d = new Date(a + "T00:00:00"), end = new Date(b + "T00:00:00"), n = 0;
    if (end < d) return 0;
    while (d < end) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
    return n;
  };

  const stageByLetter = (l) => CRITERIA.stages.find(s => s.letter === l);
  const phaseById = (id) => CRITERIA.phases.find(p => p.id === id);
  const slotById = (id) => CRITERIA.slots.find(s => s.id === id);
  const compKey = (compliant) => compliant ? "compliant" : "noncompliant";
  const ownerOf = (item, ck) => typeof item.owner === "string" ? item.owner : item.owner[ck];
  const itemById = (id) => CRITERIA.items.find(i => i.id === id);

  // Checks in scope for a file at this stage with this compliance status, in phase order.
  function scopeItems(stageLetter, compliant, cancelled) {
    const st = stageByLetter(stageLetter); if (!st) return [];
    const ck = compKey(compliant);
    const order = CRITERIA.phases.map(p => p.id);
    return CRITERIA.items
      .filter(it => it.from <= st.rank && (!it.only || it.only.includes(stageLetter)) && (it.for === "all" || it.for === ck) && (!it.cancelled || !!cancelled))
      .sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));
  }
  const slotsInScope = (items, ck) => CRITERIA.slots.filter(s => items.some(it => ownerOf(it, ck) === s.id));

  let records = [];
  const ctx = { state: "loading", master: { rtos: [], qualifications: [] }, notes: {} };
  const roleNames = () => Storage.roles.map(r => r.name);
  const rolesOf = (m) => Array.isArray(m.roles) ? m.roles : (m.role ? [m.role] : []);
  const roleSlot = (name) => (Storage.roles.find(r => r.name === name) || {}).slot || "none";
  const members = () => records.filter(r => r.type === "member" && !r.archived).sort((a, b) => a.name.localeCompare(b.name));
  const audits = () => records.filter(r => r.type === "audit").sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const memberById = (id) => records.find(r => r.type === "member" && r.id === id);
  const auditsFor = (memberId) => audits().filter(a => a.summary.byPerson.some(p => p.memberId === memberId));

  // ---- scoring ------------------------------------------------------------
  function band(score, criticalFail) {
    if (criticalFail) return "Fail";
    if (score === null) return "Not scored";
    if (score >= CRITERIA.thresholds.pass) return "Pass";
    if (score >= CRITERIA.thresholds.coaching) return "Needs coaching";
    return "Fail";
  }
  function tally(items, results) {
    let passed = 0, failed = 0, na = 0, criticalFail = false;
    items.forEach(it => {
      const r = results[it.id] && results[it.id].result;
      if (r === "pass") passed++;
      else if (r === "fail") { failed++; if (it.critical) criticalFail = true; }
      else if (r === "na") na++;
    });
    const score = (passed + failed) ? passed / (passed + failed) : null;
    return { passed, failed, na, unscored: items.length - passed - failed - na, score, criticalFail, outcome: band(score, criticalFail) };
  }
  // Who is answerable for a check: the per-check reassignment if there is one, else the person in the slot.
  const resolveOwner = (item, ck, people, overrides) => (overrides && overrides[item.id]) || people[ownerOf(item, ck)] || null;
  function computeSummary(items, results, compliant, people, overrides) {
    const ck = compKey(compliant);
    const overall = tally(items, results);
    const byPerson = [];
    items.forEach(it => {
      const slotId = ownerOf(it, ck); const slot = slotById(slotId);
      const memberId = resolveOwner(it, ck, people, overrides);
      const key = memberId || "unassigned-" + slotId;
      let p = byPerson.find(x => x.key === key);
      if (!p) { const m = memberId ? memberById(memberId) : null; p = { key, memberId, name: m ? m.name : "Unassigned", slots: [], items: [] }; byPerson.push(p); }
      const label = (overrides && overrides[it.id]) ? "Reassigned checks" : slot.label;
      if (!p.slots.includes(label)) p.slots.push(label);
      p.items.push(it);
    });
    byPerson.forEach(p => { Object.assign(p, tally(p.items, results)); delete p.items; });
    return { ...overall, byPerson };
  }
  const outcomeClass = (s) => s.criticalFail ? "fail" : s.outcome === "Pass" ? "pass" : s.outcome === "Needs coaching" ? "coach" : s.outcome === "Fail" ? "fail" : "none";
  const badge = (s, a) => a && statusOf(a) === "draft" ? `<span class="badge none">In progress</span>` : `<span class="badge ${outcomeClass(s)}">${esc(s.outcome)}${s.criticalFail ? " (critical)" : ""}</span>`;

  // ---- audit life cycle ----------------------------------------------------
  // draft  = in progress: scoring not finished; the person who started it (or an admin) can change anything.
  // scored = scored and sent for coaching: scores and file details are locked; coaching fields stay open.
  // final  = coaching logged and closed. Coaching fields can still be corrected (logged).
  // Changing locked fields: admin/owner edits with a reason; an auditor sends a change request that an admin approves.
  // The server (functions/api/[[path]].js) enforces all of this; the same rules are mirrored here for local mode.
  const statusOf = (a) => a.status === "draft" ? "draft" : a.status === "scored" ? "scored" : "final";
  const STATUS_LABEL = { draft: "In progress", scored: "Awaiting coaching", final: "Final" };
  const statusChip = (a) => `<span class="chip st-${statusOf(a)}">${STATUS_LABEL[statusOf(a)]}</span>`;
  const isDraft = (a) => statusOf(a) === "draft";
  const isMine = (a) => !cloud() || a.loggedBy === Storage.me.email;
  const canEditDraft = (a) => isDraft(a) && (can.admin || isMine(a));
  const auditLog = (a) => Array.isArray(a.changeLog) ? a.changeLog : (Array.isArray(a.editLog) ? a.editLog.map(e => ({ kind: e.status === "draft" ? "draft" : "changed", by: e.by, name: e.name, at: e.at, status: e.status })) : []);
  // per-person coaching: { notes, commitment }; older audits stored a plain string (treated as the commitment)
  const coachOf = (a, memberId) => { const v = (a.coachingByPerson || {})[memberId]; return typeof v === "string" ? { notes: "", commitment: v } : { notes: (v && v.notes) || "", commitment: (v && v.commitment) || "" }; };
  const LOCKED_FIELDS = ["auditType", "stage", "stageName", "fileRef", "qualification", "receivedDate", "date", "completeDate", "sentDate", "rto", "rtoCode", "complianceLevel", "processTo", "compliant", "people", "overrides", "itemIds", "results"];
  const COACH_FIELDS = ["coaching", "coachingByPerson", "coachingDate"];
  const FIELD_LABELS = { auditType: "Audit type", stage: "Stage", fileRef: "File", qualification: "Qualification", receivedDate: "File received", date: "Audit date", completeDate: "Portfolio complete", sentDate: "Sent to RTO", rto: "RTO", compliant: "Checklist track" };
  const RESULT_WORD = { pass: "Pass", fail: "Fail", na: "N/A" };
  function auditDiff(prev, next) {
    const out = [];
    const str = (v) => v === null || v === undefined ? "" : (typeof v === "boolean" ? (v ? "College-specific" : "Generic") : String(v));
    Object.keys(FIELD_LABELS).forEach(k => { const a = str(prev[k]), b = str(next[k]); if (a !== b) out.push(FIELD_LABELS[k] + ": " + (a || "-") + " -> " + (b || "-")); });
    const pn = prev.peopleNames || {}, nn = next.peopleNames || {};
    new Set([...Object.keys(prev.people || {}), ...Object.keys(next.people || {})]).forEach(sl => {
      const a = (prev.people || {})[sl] || "", b = (next.people || {})[sl] || "";
      if (a !== b) out.push((slotById(sl) || { label: sl }).label + ": " + (pn[sl] || "unassigned") + " -> " + (nn[sl] || "unassigned"));
    });
    const pi = prev.itemIds || [], ni = next.itemIds || [];
    if (pi.join() !== ni.join()) out.push("Checks in scope: " + pi.length + " -> " + ni.length);
    new Set([...pi, ...ni]).forEach(id => {
      const a = (prev.results || {})[id] || {}, b = (next.results || {})[id] || {};
      if ((a.result || "") !== (b.result || "")) out.push(id + ": " + (RESULT_WORD[a.result] || "unscored") + " -> " + (RESULT_WORD[b.result] || "unscored"));
      if ((a.note || "") !== (b.note || "")) out.push(id + ": note changed");
      if ((a.memberId || "") !== (b.memberId || "")) out.push(id + ": answerable " + (a.memberName || "from part") + " -> " + (b.memberName || "from part"));
    });
    return out;
  }
  // Local mode only: the same bookkeeping the server does (the local user is the owner, so nothing needs approval).
  function localApply(prev, rec, reason) {
    const at = new Date().toISOString(), who = { by: "local", name: Storage.me.name };
    if (!prev) { rec.status = rec.status === "draft" ? "draft" : "scored"; rec.changeLog = [{ kind: "created", ...who, at, status: rec.status }]; return rec; }
    const log = [...auditLog(prev)];
    rec.loggedBy = prev.loggedBy; rec.loggedAt = prev.loggedAt; rec.auditor = prev.auditor || rec.auditor; rec.createdAt = prev.createdAt;
    if (statusOf(prev) === "draft") { rec.status = rec.status === "draft" ? "draft" : "scored"; log.push({ kind: rec.status === "scored" ? "scored" : "draft", ...who, at, status: rec.status }); }
    else {
      const changes = auditDiff(prev, rec);
      if (changes.length) log.push({ kind: "changed", ...who, at, reason: reason || "", changes });
      rec.status = rec.status === "final" ? "final" : "scored";
      if (JSON.stringify(COACH_FIELDS.map(k => prev[k])) !== JSON.stringify(COACH_FIELDS.map(k => rec[k])) || rec.status !== statusOf(prev)) log.push({ kind: "coaching", ...who, at, status: rec.status });
    }
    rec.changeLog = log.slice(-100); delete rec.editLog; return rec;
  }
  async function persistAudit(prev, rec, reason) {
    if (cloud()) return Storage.save(rec, reason);
    return Storage.save(localApply(prev, rec, reason));
  }
  const pendingAudits = () => audits().filter(a => a.pending);

  function memberStats(memberId) {
    const list = auditsFor(memberId).filter(a => !isDraft(a)).map(a => ({ audit: a, mine: a.summary.byPerson.find(p => p.memberId === memberId) }));
    const scored = list.slice(0, 5).filter(x => x.mine.score !== null);
    const avg = scored.length ? scored.reduce((t, x) => t + x.mine.score, 0) / scored.length : null;
    return { count: list.length, last: list[0] || null, avg, criticals: list.filter(x => x.mine.criticalFail).length };
  }

  // ---- shell --------------------------------------------------------------
  const view = () => $("#view");
  const can = { get owner() { return Storage.me.level === "owner"; }, get admin() { return Storage.me.level === "owner" || Storage.me.level === "admin"; }, get del() { return this.admin; } };
  const cloud = () => Storage.mode === "cloudflare";
  function setStatus(msg, kind = "") {
    const el = $("#status"); el.textContent = msg; el.className = "status " + kind;
    if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ""; el.className = "status"; } }, 3500);
  }
  const auditLabel = (a) => a.auditType === "cancelled"
    ? "Cancelled (after " + (stageByLetter(a.stage)?.name || a.stage) + ")"
    : (a.auditType === "completed" ? "Completed" : "Ongoing") + " at " + (stageByLetter(a.stage)?.name || a.stage);
  const compLabel = (c) => c ? "College-specific process" : "Generic checklist";
  const trackForLevel = (level) => (CONFIG.TRACK_BY_LEVEL[level] || "noncompliant") === "compliant";
  const rtoByCode = (code) => ctx.master.rtos.find(r => r.code === String(code));
  const qualByCode = (code) => ctx.master.qualifications.find(q => q.code.toUpperCase() === String(code).trim().toUpperCase());

  // ---- home ---------------------------------------------------------------
  function renderHome() {
    const list = members();
    const recent = audits().slice(0, 8);
    view().innerHTML = `
      <section class="hero">
        <div>
          <h1>Team</h1>
          <p class="muted">Audits are of files: a completed file end to end, a live file at its current stage, or a cancelled file. Each person's score is built from the checks they were answerable for.</p>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="#/new">New audit</a>
          ${can.admin ? `<a class="btn ghost" href="#/team">Manage team</a>` : ""}
          <a class="btn ghost" href="#/criteria">View checks</a>
        </div>
      </section>

      <section class="cards">
        ${list.length ? list.map(m => {
          const st = memberStats(m.id);
          return `
          <article class="member">
            <div class="member-head">
              <div><h2><a href="#/member/${esc(m.id)}">${esc(m.name)}</a></h2><div class="role">${esc(rolesOf(m).join(", ") || "No role")}</div></div>
              ${st.last ? badge(st.last.mine) : `<span class="badge none">No audits yet</span>`}
            </div>
            <dl class="stats">
              <div><dt>Audits</dt><dd>${st.count}</dd></div>
              <div><dt>Avg, last 5</dt><dd>${pct(st.avg)}</dd></div>
              <div><dt>Critical</dt><dd class="${st.criticals ? "warn" : ""}">${st.criticals}</dd></div>
              <div><dt>Last</dt><dd>${st.last ? fmtDate(st.last.audit.date) : "-"}</dd></div>
            </dl>
            <div class="member-actions"><a class="btn ghost" href="#/member/${esc(m.id)}">History</a></div>
          </article>`;
        }).join("") : `<p class="empty">No team members yet. ${can.admin ? `<a href="#/team">Add the team</a> to start.` : "Ask an admin to add the team."}</p>`}
      </section>

      ${can.admin && pendingAudits().length ? `<section class="pending-list"><h3>Change requests waiting for approval</h3>${pendingAudits().map(a => `<p><a href="#/audit/${esc(a.id)}"><strong>${esc(a.fileRef || a.id)}</strong></a>: ${esc(a.pending.name || a.pending.by)} on ${fmtDate(String(a.pending.at).slice(0, 10))}. ${esc(a.pending.reason)} <span class="muted small">(${a.pending.changes.length} change${a.pending.changes.length === 1 ? "" : "s"})</span></p>`).join("")}</section>` : ""}
      <section class="two-col">
        <div>
          <h3>Recent audits</h3>
          ${recent.length ? `<div class="table-wrap"><table class="list">
            <thead><tr><th>Audited</th><th>File</th><th>Type</th><th>RTO</th><th>Score</th><th>Outcome</th></tr></thead>
            <tbody>${recent.map(a => `<tr onclick="location.hash='#/audit/${esc(a.id)}'">
              <td>${fmtDate(a.date)}</td><td>${esc(a.fileRef || "-")}</td><td>${esc(auditLabel(a))}</td>
              <td>${esc(a.rtoCode ? a.rtoCode : (a.rto || "-"))} <span class="muted small">${esc(a.complianceLevel || compLabel(a.compliant))}</span></td>
              <td>${isDraft(a) ? "-" : pct(a.summary.score)}</td><td>${badge(a.summary, a)}${statusOf(a) === "scored" ? " " + statusChip(a) : ""}${a.pending ? ` <span class="chip st-pending">Change requested</span>` : ""}</td></tr>`).join("")}</tbody>
          </table></div>` : `<p class="muted">Nothing logged yet.</p>`}
        </div>
        <aside class="panel">
          <h3>Sampling</h3>
          <ul class="plain">${CONFIG.cadence.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
          <h3>Scoring</h3>
          <ul class="plain">
            <li>Score = Pass / (Pass + Fail). N/A is left out.</li>
            <li>${Math.round(CRITERIA.thresholds.pass * 100)}% and above: Pass.</li>
            <li>${Math.round(CRITERIA.thresholds.coaching * 100)}% to ${Math.round(CRITERIA.thresholds.pass * 100) - 1}%: Needs coaching.</li>
            <li>Below ${Math.round(CRITERIA.thresholds.coaching * 100)}%, or any Critical check failed: Fail.</li>
          </ul>
          <h3>How an audit moves</h3>
          <ul class="plain">
            <li><strong>In progress</strong>: being scored. Only the person who started it, or an admin, can change it.</li>
            <li><strong>Awaiting coaching</strong>: scored and sent to the person. Scores and file details are locked; coaching notes stay open.</li>
            <li><strong>Final</strong>: coaching logged and commitments recorded.</li>
            <li>Changing a locked score or detail: an admin edits it with a reason; an auditor sends a change request for an admin to approve. Everything is logged on the audit.</li>
          </ul>
          <p class="muted small">${cloud()
            ? `Signed in as ${esc(Storage.me.name)} (${esc(Storage.me.level)}). ${can.admin ? "You can delete audits and manage the team." : "You can view and add audits."}${can.owner ? ' <a href="#/data">Backup</a>' : ""}`
            : `Storage: this browser only. <a href="#/data">Backup</a>`}</p>
        </aside>
      </section>`;
  }

  // ---- member -------------------------------------------------------------
  function renderMember(id) {
    const m = memberById(id);
    if (!m) { view().innerHTML = `<p class="empty">Member not found. <a href="#/">Back</a></p>`; return; }
    const st = memberStats(id);
    const list = auditsFor(id);
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / ${esc(m.name)}</nav>
      <section class="hero">
        <div><h1>${esc(m.name)}</h1><p class="muted">${esc(rolesOf(m).join(", ") || "No role")}${m.archived ? " (archived)" : ""}</p></div>
        <div class="hero-actions"><a class="btn primary" href="#/new">New audit</a></div>
      </section>
      <dl class="stats wide">
        <div><dt>Audits</dt><dd>${st.count}</dd></div>
        <div><dt>Avg score, last 5</dt><dd>${pct(st.avg)}</dd></div>
        <div><dt>Critical fails</dt><dd class="${st.criticals ? "warn" : ""}">${st.criticals}</dd></div>
        <div><dt>Last outcome</dt><dd>${st.last ? badge(st.last.mine) : "-"}</dd></div>
      </dl>
      <h3>Audit history</h3>
      ${list.length ? `<div class="table-wrap"><table class="list">
        <thead><tr><th>Audited</th><th>File</th><th>Type</th><th>Their part</th><th>Their score</th><th>Their outcome</th><th>File outcome</th><th></th></tr></thead>
        <tbody>${list.map(a => { const p = a.summary.byPerson.find(x => x.memberId === id); return `<tr>
          <td>${fmtDate(a.date)}</td><td>${esc(a.fileRef || "-")}</td><td>${esc(auditLabel(a))}</td>
          <td>${esc(p.slots.join(", "))}</td><td>${isDraft(a) ? "-" : pct(p.score)}</td><td>${badge(p, a)}</td><td>${badge(a.summary, a)}</td>
          <td class="row-actions"><a href="#/audit/${esc(a.id)}">Open</a> <button class="link" data-ppdf="${esc(a.id)}">Their copy</button> <button class="link" data-pdf="${esc(a.id)}">File PDF</button></td></tr>`; }).join("")}</tbody>
      </table></div>` : `<p class="muted">No audits yet for ${esc(m.name)}.</p>`}`;
    view().querySelectorAll("[data-pdf]").forEach(b => b.addEventListener("click", () => downloadPdf(b.dataset.pdf)));
    view().querySelectorAll("[data-ppdf]").forEach(b => b.addEventListener("click", () => downloadPersonPdf(b.dataset.ppdf, id)));
  }

  // ---- new audit ----------------------------------------------------------
  function renderNew(editId) {
    const team = members();
    if (!team.length) { view().innerHTML = `<p class="empty">${can.admin ? `Add the team first. <a href="#/team">Manage team</a>` : "No team members yet. Ask an admin to add the team."}</p>`; return; }
    const existing = editId ? audits().find(x => x.id === editId) : null;
    if (editId && !existing) { view().innerHTML = `<p class="empty">Audit not found. <a href="#/">Back</a></p>`; return; }
    const locked = !!existing && !isDraft(existing);
    const requesting = locked && !can.admin;   // an auditor on a locked audit can only propose changes
    if (existing && isDraft(existing) && !canEditDraft(existing)) { view().innerHTML = `<p class="empty">Only the person who started this audit, or an admin, can change it while it is in progress. <a href="#/audit/${esc(existing.id)}">Back</a></p>`; return; }
    if (requesting && existing.pending && existing.pending.by !== Storage.me.email) { view().innerHTML = `<p class="empty">A change request by ${esc(existing.pending.name || existing.pending.by)} is already waiting on this audit. It has to be approved or rejected before another one can be sent. <a href="#/audit/${esc(existing.id)}">Back</a></p>`; return; }

    const draft = {
      auditType: "completed", stage: "G", fileRef: "", qualification: "", qualOther: "", receivedDate: "", completeDate: "", sentDate: "", date: today(),
      auditor: cloud() ? Storage.me.name : (localStorage.getItem("atsr_qa_auditor") || ""),
      rtoCode: "", rtoOther: "", compliant: false,
      people: {}, results: {}, coaching: "", coachingByPerson: {}, coachingDate: "", overrides: {}, reason: "",
    };
    if (existing) {
      const e = existing;
      Object.assign(draft, {
        auditType: e.auditType, stage: e.stage, fileRef: e.fileRef || "", receivedDate: e.receivedDate || "", completeDate: e.completeDate || "", sentDate: e.sentDate || "", date: e.date || today(),
        auditor: e.auditor || draft.auditor, rtoCode: e.rtoCode || (e.rto ? "other" : ""), rtoOther: e.rtoCode ? "" : (e.rto || ""), compliant: !!e.compliant,
        people: { ...(e.people || {}) }, coaching: e.coaching || "", coachingByPerson: { ...(e.coachingByPerson || {}) }, coachingDate: e.coachingDate || "", overrides: { ...(e.overrides || {}) },
        results: Object.fromEntries(Object.entries(e.results || {}).map(([k, v]) => [k, { result: v.result || null, note: v.note || "" }])),
      });
      const qcode = (e.qualification || "").split(" ")[0];
      if (qualByCode(qcode)) draft.qualification = qcode; else { draft.qualification = e.qualification || ""; draft.qualOther = e.qualification || ""; }
    }
    const cancelled = () => draft.auditType === "cancelled";
    const rto = () => draft.rtoCode && draft.rtoCode !== "other" ? rtoByCode(draft.rtoCode) : null;
    const rtoName = () => rto() ? rto().name : draft.rtoOther.trim();
    // who to prefill: the first active member holding a role mapped to that part of the file
    const firstWithSlot = (key) => team.find(m => rolesOf(m).some(r => roleSlot(r) === key));
    function defaultPeople() {
      const p = {};
      CRITERIA.slots.forEach(s => {
        let m = null;
        if (s.id === "review") m = draft.compliant ? firstWithSlot("compliant") : (firstWithSlot("review") || firstWithSlot("drafting"));
        else m = firstWithSlot(s.id);
        p[s.id] = draft.people[s.id] || (m ? m.id : "");
      });
      return p;
    }
    draft.people = defaultPeople();
    const whoOptions = (sel) => team.map(m => `<option value="${m.id}" ${sel === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("");

    const levels = ["Compliant", "Less Compliant", "Non Compliant"];
    const active = ctx.master.rtos.filter(r => !r.archived);
    const archived = ctx.master.rtos.filter(r => r.archived);
    const opt = (r) => `<option value="${esc(r.code)}">${esc(r.name)} - ${esc(r.code)}</option>`;
    const rtoOptions = `<option value="">Select the RTO</option>` +
      levels.map(l => { const list = active.filter(r => r.level === l); return list.length ? `<optgroup label="${esc(l)}">${list.map(opt).join("")}</optgroup>` : ""; }).join("") +
      (archived.length ? `<optgroup label="Archived RTOs">${archived.map(opt).join("")}</optgroup>` : "") +
      `<option value="other">Other (type it)</option>`;

    const packages = [...new Set(ctx.master.qualifications.map(q => q.package || "Other"))].sort();
    const qualOptions = `<option value="">Select the qualification</option>` +
      packages.map(pk => `<optgroup label="${esc(pk)}">${ctx.master.qualifications.filter(q => (q.package || "Other") === pk).map(q => `<option value="${esc(q.code)}">${esc(q.code)} - ${esc(q.title)}</option>`).join("")}</optgroup>`).join("") +
      `<option value="other">Other (type it)</option>`;

    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / ${existing ? `<a href="#/audit/${esc(existing.id)}">${esc(existing.fileRef || existing.id)}</a> / Edit` : "New audit"}</nav>
      <section class="hero"><div><h1>${existing ? (isDraft(existing) ? "Continue audit" : requesting ? "Request a change" : "Edit audit") : "New audit"}</h1><p class="muted">${requesting ? "Scores and file details are locked once an audit is scored. Make the changes, give the reason, and an admin or the owner will approve or reject them. Coaching notes are logged from the audit page." : locked ? "Your changes apply straight away and are logged with your name, the date and the reason. The original auditor stays on the record. Coaching notes are logged from the audit page." : "Fill in the file first. The checks below adjust to the audit type, the stage and the college."}</p></div></section>
      <form id="audit-form" class="audit" autocomplete="off">
        <div class="audit-main">
          <div class="head-block">
            <div class="seg wide" role="group" aria-label="Audit type">
              <button type="button" data-type="completed" class="on">Completed file</button>
              <button type="button" data-type="ongoing">Ongoing file</button>
              <button type="button" data-type="cancelled">Cancelled file</button>
            </div>
            <div class="meta-grid three">
              <label><span id="stage-label">Stage at audit</span> <select id="f-stage"></select></label>
              <label>File / opportunity <input id="f-file" type="text" placeholder="e.g. Anita Sharma_CHC40221" required></label>
              <label>Auditor <input id="f-auditor" type="text" value="${esc(draft.auditor)}" placeholder="Your name" required ${cloud() ? "readonly" : ""}></label>
              <label>File received <input id="f-received" type="date" required></label>
              <label>Audit date <input id="f-date" type="date" value="${today()}" required></label>
              <label id="complete-wrap">Portfolio complete on <input id="f-complete" type="date"></label>
              <label id="sent-wrap">Sent to RTO on <input id="f-sent" type="date"></label>
              <label>Checklist track
                <select id="f-comp"><option value="1">College-specific process</option><option value="0" selected>Generic checklist</option></select>
              </label>
              <label class="span3">RTO <select id="f-rto">${rtoOptions}</select></label>
              <label id="rto-other-wrap" class="span3" hidden>RTO name and code <input id="f-rto-other" type="text" placeholder="RTO name and code"></label>
              <label class="span3">Qualification <select id="f-qual">${qualOptions}</select></label>
              <label id="qual-other-wrap" class="span3" hidden>Qualification code and title <input id="f-qual-other" type="text" placeholder="e.g. CPC30220 Certificate III in Carpentry"></label>
            </div>
            <p id="file-facts" class="facts"></p>
            <div id="people" class="people"></div>
          </div>
          <div id="reminders"></div>
          <div id="items"></div>
          <label class="coaching" ${locked ? "hidden" : ""}>Coaching note (whole file)
            <textarea id="f-coaching" rows="3" placeholder="Optional at this point. Goes on the file PDF only; can mention anyone. Usually filled in after coaching, from the audit page."></textarea>
          </label>
          <div id="person-notes" class="person-notes" ${locked ? "hidden" : ""}></div>
        </div>
        <aside class="result-panel" id="result-panel"></aside>
      </form>`;

    if (existing) {
      $("#audit-form").querySelectorAll("[data-type]").forEach(x => x.classList.toggle("on", x.dataset.type === draft.auditType));
      $("#f-file").value = draft.fileRef; $("#f-received").value = draft.receivedDate; $("#f-date").value = draft.date;
      $("#f-complete").value = draft.completeDate; $("#f-sent").value = draft.sentDate; $("#f-auditor").value = draft.auditor;
      $("#f-rto").value = draft.rtoCode || ""; $("#f-rto-other").value = draft.rtoOther; $("#f-comp").value = draft.compliant ? "1" : "0";
      if (qualByCode(draft.qualification)) $("#f-qual").value = draft.qualification; else if (draft.qualOther) { $("#f-qual").value = "other"; $("#f-qual-other").value = draft.qualOther; }
      $("#f-coaching").value = draft.coaching;
    }

    // ---- per-person notes: one box per distinct assigned person; goes on that person's copy only
    function fillPersonNotes() {
      const seen = new Set(); const rows = [];
      CRITERIA.slots.forEach(sl => { const id = draft.people[sl.id]; if (id && !seen.has(id) && $(`#people select[data-slot="${sl.id}"]`)) { seen.add(id); const m = memberById(id); if (m) rows.push(m); } });
      scopeItems(draft.stage, draft.compliant, cancelled()).forEach(it => { const id = draft.overrides[it.id]; if (id && !seen.has(id)) { seen.add(id); const m = memberById(id); if (m) rows.push(m); } });
      $("#person-notes").innerHTML = rows.length ? `<div class="people-title">Coaching per person</div><p class="muted small">Optional now; normally logged after coaching from the audit page. Each person's notes and commitment go on their own copy only.</p>` +
        rows.map(m => { const c = coachOf(draft, m.id); return `<div class="pn"><strong>${esc(m.name)}</strong><label>Coaching notes<textarea data-pnote="${esc(m.id)}" data-k="notes" rows="2" placeholder="What was discussed with ${esc(m.name.split(" ")[0])}.">${esc(c.notes)}</textarea></label><label>Commitment<textarea data-pnote="${esc(m.id)}" data-k="commitment" rows="2" placeholder="What ${esc(m.name.split(" ")[0])} agreed to change, by when.">${esc(c.commitment)}</textarea></label></div>`; }).join("") : "";
      $("#person-notes").querySelectorAll("textarea[data-pnote]").forEach(t => t.addEventListener("input", () => { const c = coachOf(draft, t.dataset.pnote); c[t.dataset.k] = t.value; draft.coachingByPerson[t.dataset.pnote] = c; }));
    }

    // ---- header wiring
    function fillStages() {
      const sel = $("#f-stage");
      const opts = CRITERIA.stages.filter(s => s.type === (cancelled() ? "ongoing" : draft.auditType));
      if (!opts.some(s => s.letter === draft.stage)) draft.stage = opts[opts.length - 1].letter;
      $("#stage-label").textContent = cancelled() ? "Last stage before cancelling" : "Stage at audit";
      sel.innerHTML = opts.map(s => `<option value="${s.letter}" ${s.letter === draft.stage ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    }
    function fillPeople() {
      const items = scopeItems(draft.stage, draft.compliant, cancelled());
      const slots = slotsInScope(items, compKey(draft.compliant));
      $("#people").innerHTML = `<div class="people-title">Who handled this file</div><div class="people-grid">` +
        slots.map(s => `<label>${esc(s.label)}<select data-slot="${s.id}"><option value="">Unassigned</option>${team.map(m => `<option value="${m.id}" ${draft.people[s.id] === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>`).join("") + `</div>`;
      $("#people").querySelectorAll("select[data-slot]").forEach(sel => sel.addEventListener("change", () => { draft.people[sel.dataset.slot] = sel.value; fillPersonNotes(); renderItems(); }));
      fillPersonNotes();
    }
    // Wait between Complete Portfolio and submission. Reached submission: complete -> sent. Still at
    // Complete Portfolio: complete -> audit date (still waiting).
    function submitWait() {
      const rank = (stageByLetter(draft.stage) || {}).rank || 0;
      if (!draft.completeDate || rank < 3) return null;
      if (draft.stage === "D") { const n = businessDays(draft.completeDate, draft.date); return n === null ? null : { days: n, over: n > CONFIG.SUBMIT_WITHIN_BUSINESS_DAYS, label: "at Complete Portfolio, not yet sent" }; }
      if (rank >= 4 && draft.sentDate) { const n = businessDays(draft.completeDate, draft.sentDate); return n === null ? null : { days: n, over: n > CONFIG.SUBMIT_WITHIN_BUSINESS_DAYS, label: "from complete to sent to RTO" }; }
      return null;
    }
    function fillDateVisibility() {
      const rank = (stageByLetter(draft.stage) || {}).rank || 0;
      $("#complete-wrap").hidden = rank < 3;
      $("#sent-wrap").hidden = rank < 4;
    }
    function fillFacts() {
      const bits = [];
      const r = rto();
      if (r) bits.push(`<span><b>Compliance level</b> ${esc(r.level || "-")}${r.archived ? " (archived RTO)" : ""}</span>`, `<span><b>Process To</b> ${esc(r.processTo || "-")}</span>`, r.type ? `<span><b>Type</b> ${esc(r.type)}</span>` : "");
      const q = qualByCode(draft.qualification);
      if (q) bits.push(`<span><b>${esc(q.code)}</b> ${esc(q.title)}</span>`, `<span><b>Entry requirement</b> ${esc(q.entry || "-")}</span>`);
      const d = daysBetween(draft.receivedDate, draft.date);
      if (d !== null) bits.push(`<span><b>${d} days</b> from file received to audit</span>`);
      const sw = submitWait();
      if (sw) bits.push(`<span class="${sw.over ? "fact-warn" : ""}"><b>${sw.days} business day${sw.days === 1 ? "" : "s"}</b> ${sw.label} (allowed: ${CONFIG.SUBMIT_WITHIN_BUSINESS_DAYS})</span>`);
      $("#file-facts").innerHTML = bits.filter(Boolean).join("");
    }
    function fillReminders() {
      const ck = compKey(draft.compliant);
      const notes = rto() ? (ctx.notes[rto().code] || []) : [];
      const title = rto() ? rto().name : (draft.rtoOther.trim() || "College");
      $("#reminders").innerHTML = `
        ${draft.compliant ? `<div class="remind college"><strong>${esc(title)}: process notes</strong>${notes.length ? `<ul>${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="muted small">No notes recorded for this college yet. Add them in functions/api/college-notes.js, keyed by RTO code.</p>`}</div>` : ""}
        <div class="remind"><strong>Follow-up cadence, ${esc(compLabel(draft.compliant).toLowerCase())}</strong><ul>${(CONFIG.CADENCE[ck] || []).map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
    }
    const refreshTrack = () => { draft.people = {}; draft.people = defaultPeople(); fillPeople(); fillReminders(); renderItems(); };

    $("#audit-form").querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => {
      draft.auditType = b.dataset.type;
      $("#audit-form").querySelectorAll("[data-type]").forEach(x => x.classList.toggle("on", x === b));
      fillStages(); fillDateVisibility(); fillFacts(); fillPeople(); renderItems();
    }));
    $("#f-stage").addEventListener("change", e => { draft.stage = e.target.value; fillDateVisibility(); fillFacts(); fillPeople(); renderItems(); });
    $("#f-file").addEventListener("input", e => { draft.fileRef = e.target.value; refreshPanel(); });
    $("#f-qual").addEventListener("change", e => {
      draft.qualification = e.target.value === "other" ? draft.qualOther : e.target.value;
      $("#qual-other-wrap").hidden = e.target.value !== "other";
      fillFacts();
    });
    $("#f-qual-other").addEventListener("input", e => { draft.qualOther = e.target.value; draft.qualification = e.target.value; });
    $("#f-received").addEventListener("change", e => { draft.receivedDate = e.target.value; fillFacts(); });
    $("#f-date").addEventListener("change", e => { draft.date = e.target.value; fillFacts(); });
    $("#f-complete").addEventListener("change", e => { draft.completeDate = e.target.value; fillFacts(); });
    $("#f-sent").addEventListener("change", e => { draft.sentDate = e.target.value; fillFacts(); });
    $("#f-auditor").addEventListener("input", e => draft.auditor = e.target.value);
    $("#f-rto").addEventListener("change", e => {
      draft.rtoCode = e.target.value;
      $("#rto-other-wrap").hidden = draft.rtoCode !== "other";
      if (rto()) { draft.compliant = trackForLevel(rto().level); $("#f-comp").value = draft.compliant ? "1" : "0"; }
      fillFacts(); refreshTrack();
    });
    $("#f-rto-other").addEventListener("input", e => { draft.rtoOther = e.target.value; fillReminders(); });
    $("#f-comp").addEventListener("change", e => { draft.compliant = e.target.value === "1"; refreshTrack(); });
    $("#f-coaching").addEventListener("input", e => draft.coaching = e.target.value);

    // ---- checklist
    function renderItems() {
      const items = scopeItems(draft.stage, draft.compliant, cancelled());
      const ck = compKey(draft.compliant);
      let html = "", lastPhase = null, n = 0;
      if (cancelled()) html += `<p class="muted small">Score the stages the file went through before it was cancelled. Use N/A for any step that never happened.</p>`;
      items.forEach(it => {
        if (it.phase !== lastPhase) { const ph = phaseById(it.phase); html += `<h3 class="phase">${esc(ph.title)} <span class="muted">${esc(ph.sop)}</span></h3>`; lastPhase = it.phase; }
        n++;
        const r = draft.results[it.id] || { result: null, note: "" };
        const slot = slotById(ownerOf(it, ck)); const slotPerson = draft.people[slot.id] || ""; const ov = draft.overrides[it.id] || "";
        html += `
          <div class="item ${r.result === "fail" ? "is-fail" : ""} ${ov ? "is-reassigned" : ""}" data-id="${it.id}">
            <div class="item-n">${n}</div>
            <div class="item-body">
              <p>${esc(it.text)}</p>
              <div class="item-meta"><span class="who">${esc(slot.label)}:</span><select class="who-sel" data-who="${it.id}" title="Who did this on this file"><option value="">${esc(slotPerson ? (memberById(slotPerson) || {}).name || "Unassigned" : "Unassigned")} (from part)</option>${whoOptions(ov)}</select>${ov ? `<span class="reassigned">reassigned</span>` : ""}<span class="ref">${esc(it.ref)}</span>${it.critical ? `<span class="crit">Critical</span>` : ""}</div>
              <textarea class="note" placeholder="Notes / evidence (required for a Fail)" rows="1">${esc(r.note)}</textarea>
            </div>
            <div class="seg" role="group" aria-label="Result for check ${n}">
              <button type="button" data-r="pass" class="${r.result === "pass" ? "on" : ""}">Pass</button>
              <button type="button" data-r="fail" class="${r.result === "fail" ? "on" : ""}">Fail</button>
              <button type="button" data-r="na" class="${r.result === "na" ? "on" : ""}">N/A</button>
            </div>
          </div>`;
      });
      $("#items").innerHTML = html || `<p class="muted">No checks apply at this stage.</p>`;
      $("#items").querySelectorAll(".item").forEach(row => {
        const id = row.dataset.id;
        row.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
          const cur = draft.results[id] || (draft.results[id] = { result: null, note: "" });
          cur.result = cur.result === b.dataset.r ? null : b.dataset.r;
          row.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x.dataset.r === cur.result));
          row.classList.toggle("is-fail", cur.result === "fail");
          refreshPanel();
        }));
        const who = row.querySelector(".who-sel");
        who.addEventListener("change", () => { if (who.value) draft.overrides[id] = who.value; else delete draft.overrides[id]; fillPersonNotes(); renderItems(); });
        const note = row.querySelector(".note");
        const grow = () => { note.style.height = "auto"; note.style.height = note.scrollHeight + "px"; };
        note.addEventListener("input", () => { (draft.results[id] || (draft.results[id] = { result: null, note: "" })).note = note.value; grow(); refreshPanel(); });
        if (note.value) grow();
      });
      refreshPanel();
    }

    const panel = $("#result-panel");
    function refreshPanel() {
      const items = scopeItems(draft.stage, draft.compliant, cancelled());
      const s = computeSummary(items, draft.results, draft.compliant, draft.people, draft.overrides);
      const missingNotes = items.some(it => draft.results[it.id]?.result === "fail" && !(draft.results[it.id].note || "").trim());
      const unassigned = s.byPerson.some(p => !p.memberId);
      const noRto = !rto() && !draft.rtoOther.trim();
      panel.innerHTML = `
        <div class="score ${outcomeClass(s)}">
          <div class="big">${pct(s.score)}</div>
          <div class="word">${esc(s.outcome)}</div>
          ${s.criticalFail ? `<div class="why">Critical check failed</div>` : ""}
        </div>
        <dl class="tally">
          <div><dt>Pass</dt><dd>${s.passed}</dd></div><div><dt>Fail</dt><dd>${s.failed}</dd></div>
          <div><dt>N/A</dt><dd>${s.na}</dd></div><div><dt>Left</dt><dd>${s.unscored}</dd></div>
        </dl>
        <div class="people-scores">${s.byPerson.map(p => `<div class="ps"><div><strong>${esc(p.name)}</strong><span class="muted small">${esc(p.slots.join(", "))}</span></div><div class="ps-r ${outcomeClass(p)}">${pct(p.score)}</div></div>`).join("")}</div>
        ${missingNotes ? `<p class="warn small">Every Fail needs a note.</p>` : ""}
        ${unassigned ? `<p class="warn small">Assign a person to every part in scope.</p>` : ""}
        ${noRto ? `<p class="warn small">Select the RTO.</p>` : ""}
        ${locked ? `
          <div class="changes" id="change-preview"></div>
          <label class="reason">Reason for the change <textarea id="f-reason" rows="3" placeholder="${requesting ? "Why the score or detail should change, e.g. what the person showed during coaching." : "Why this is being changed. Printed in the audit history."}">${esc(draft.reason)}</textarea></label>
          <button type="submit" class="btn primary block" ${s.unscored || missingNotes || unassigned || noRto || !items.length ? "disabled" : ""}>${requesting ? "Send for approval" : "Save changes"}</button>
          <a class="btn ghost block" href="#/audit/${esc(existing.id)}">Cancel</a>
          <p class="muted small">${requesting ? "An admin or the owner approves or rejects the request. Nothing changes until then." : "Logged with your name, the date and the reason."}</p>` : `
          <button type="submit" class="btn primary block" ${s.unscored || missingNotes || unassigned || noRto || !items.length ? "disabled" : ""}>Save scores</button>
          <button type="button" class="btn ghost block" id="btn-draft" ${!draft.fileRef.trim() ? "disabled" : ""}>Save, still in progress</button>
          <a class="btn ghost block" href="${existing ? "#/audit/" + esc(existing.id) : "#/"}">Cancel</a>
          <p class="muted small">Save scores locks the scores and file details and starts the coaching step. In progress keeps everything open and counts in nobody's score.</p>`}
        <p class="muted small">Checks v${esc(CRITERIA.version)}. ${items.length} in scope.</p>`;
      if ($("#btn-draft")) $("#btn-draft").addEventListener("click", () => saveAudit("draft"));
      if (locked) {
        $("#f-reason").addEventListener("input", e => draft.reason = e.target.value);
        const ch = auditDiff(existing, buildAudit(statusOf(existing)));
        $("#change-preview").innerHTML = ch.length ? `<strong>Changes (${ch.length})</strong><ul>${ch.map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : `<span class="muted small">No changes yet.</span>`;
      }
    }

    fillStages(); fillDateVisibility(); fillPeople(); fillFacts(); fillReminders(); renderItems();
    $("#rto-other-wrap").hidden = true;
    $("#qual-other-wrap").hidden = true;

    $("#audit-form").addEventListener("submit", (e) => { e.preventDefault(); saveAudit(locked ? statusOf(existing) : "scored"); });
    function buildAudit(status) {
      const items = scopeItems(draft.stage, draft.compliant, cancelled());
      const ck = compKey(draft.compliant);
      const peopleNames = {}; Object.keys(draft.people).forEach(k => { const m = memberById(draft.people[k]); if (m) peopleNames[k] = m.name; });
      const r = rto(); const q = qualByCode(draft.qualification);
      const ownerName = (it) => { const id = resolveOwner(it, ck, draft.people, draft.overrides); const m = id ? memberById(id) : null; return { memberId: id || "", memberName: m ? m.name : "" }; };
      const involved = new Set([...Object.values(draft.people), ...Object.values(draft.overrides)]);
      const audit = {
        id: existing ? existing.id : uid("QA"), type: "audit", status,
        auditType: draft.auditType, stage: draft.stage, stageName: stageByLetter(draft.stage).name,
        fileRef: draft.fileRef.trim(),
        qualification: q ? q.code + " " + q.title : draft.qualification.trim(),
        receivedDate: draft.receivedDate, date: draft.date, daysInPipeline: daysBetween(draft.receivedDate, draft.date),
        completeDate: draft.completeDate || "", sentDate: draft.sentDate || "",
        submitWait: (() => { const w = submitWait(); return w ? { businessDays: w.days, over: w.over, label: w.label, allowed: CONFIG.SUBMIT_WITHIN_BUSINESS_DAYS } : null; })(),
        auditor: draft.auditor.trim(),
        rto: rtoName(), rtoCode: r ? r.code : "", complianceLevel: r ? r.level : "", processTo: r ? r.processTo : "",
        compliant: draft.compliant,
        people: Object.fromEntries(slotsInScope(items, ck).map(s => [s.id, draft.people[s.id] || ""])), peopleNames,
        itemIds: items.map(it => it.id),
        results: Object.fromEntries(items.map(it => [it.id, { result: draft.results[it.id]?.result || null, note: (draft.results[it.id]?.note || "").trim(), owner: ownerOf(it, ck), ...ownerName(it) }])),
        overrides: Object.fromEntries(Object.entries(draft.overrides).filter(([id]) => items.some(it => it.id === id))),
        coaching: draft.coaching.trim(), coachingDate: draft.coachingDate || "",
        coachingByPerson: Object.fromEntries(Object.keys(draft.coachingByPerson).filter(id => involved.has(id)).map(id => [id, { notes: coachOf(draft, id).notes.trim(), commitment: coachOf(draft, id).commitment.trim() }]).filter(([, c]) => c.notes || c.commitment)),
        summary: computeSummary(items, draft.results, draft.compliant, draft.people, draft.overrides),
        criteriaVersion: CRITERIA.version, createdAt: existing ? existing.createdAt : new Date().toISOString(),
      };
      if (existing) { ["loggedBy", "loggedAt", "changeLog", "pending"].forEach(k => { if (existing[k] !== undefined) audit[k] = existing[k]; }); if (locked) { audit.coaching = existing.coaching || ""; audit.coachingByPerson = existing.coachingByPerson || {}; audit.coachingDate = existing.coachingDate || ""; audit.auditor = existing.auditor || audit.auditor; } }
      return audit;
    }
    async function saveAudit(status) {
      localStorage.setItem("atsr_qa_auditor", draft.auditor.trim());
      const audit = buildAudit(status);
      try {
        let rec;
        if (locked) {
          const changes = auditDiff(existing, audit);
          if (!changes.length) { setStatus("Nothing has changed.", "err"); return; }
          if (!draft.reason.trim()) { setStatus("Give the reason for the change.", "err"); $("#f-reason").focus(); return; }
          rec = requesting ? await Storage.requestChange(existing.id, audit, draft.reason.trim()) : await persistAudit(existing, audit, draft.reason.trim());
        } else rec = await persistAudit(existing, audit);
        rec = rec && rec.id ? rec : audit;
        records = records.filter(r => r.id !== rec.id).concat(rec);
        setStatus(requesting ? "Change request sent for approval." : status === "draft" ? "Saved, still in progress." : locked ? "Changes saved." : "Scores saved. Download the PDF and book the coaching.", "ok");
        location.hash = "#/audit/" + audit.id;
      } catch (err) { setStatus("Could not save: " + err.message, "err"); }
    }
  }

  // ---- audit view ---------------------------------------------------------
  const LOG_WORD = { created: "Created", draft: "Saved, in progress", scored: "Scored", coaching: "Coaching log updated", changed: "Changed", requested: "Change requested", approved: "Change approved", rejected: "Change rejected" };
  function logLine(e) {
    const when = fmtDate(String(e.at).slice(0, 10));
    const tidy = (t) => String(t).trim().replace(/[.\s]+$/, "");
    let t = `<strong>${esc(LOG_WORD[e.kind] || e.kind)}</strong> by ${esc(e.decidedName || e.decidedBy || e.name || e.by)} on ${when}`;
    if (e.kind === "coaching" && e.status) t += ` (${esc(STATUS_LABEL[e.status] || e.status).toLowerCase()})`;
    if (e.kind === "approved" || e.kind === "rejected") t += ` (requested by ${esc(e.name || e.by)})`;
    if (e.reason) t += `. Reason: ${esc(tidy(e.reason))}`;
    if (e.note) t += `. Note: ${esc(tidy(e.note))}`;
    t += ".";
    if (e.changes && e.changes.length) t += `<ul class="small">${e.changes.map(c => `<li>${esc(c)}</li>`).join("")}</ul>`;
    return `<li>${t}</li>`;
  }
  function renderAudit(id) {
    const a = audits().find(x => x.id === id);
    if (!a) { view().innerHTML = `<p class="empty">Audit not found. <a href="#/">Back</a></p>`; return; }
    const s = a.summary, st = statusOf(a);
    let html = "", lastPhase = null, n = 0;
    a.itemIds.forEach(iid => {
      const it = itemById(iid); if (!it) return;
      if (it.phase !== lastPhase) { const ph = phaseById(it.phase); html += `<h3 class="phase">${esc(ph.title)} <span class="muted">${esc(ph.sop)}</span></h3>`; lastPhase = it.phase; }
      n++;
      const r = a.results[iid] || {}; const slot = slotById(r.owner); const whoName = r.memberName || a.peopleNames[r.owner] || "";
      html += `
        <div class="item ${r.result === "fail" ? "is-fail" : ""}">
          <div class="item-n">${n}</div>
          <div class="item-body">
            <p>${esc(it.text)}</p>
            <div class="item-meta"><span class="who">${esc(slot?.label || "")}${whoName ? ": " + esc(whoName) : ""}</span>${a.overrides && a.overrides[iid] ? `<span class="reassigned">reassigned</span>` : ""}<span class="ref">${esc(it.ref)}</span>${it.critical ? `<span class="crit">Critical</span>` : ""}</div>
            ${r.note ? `<p class="note-ro">${esc(r.note)}</p>` : ""}
          </div>
          <div class="seg"><span class="pill ${esc(r.result || "none")}">${r.result === "pass" ? "Pass" : r.result === "fail" ? "Fail" : r.result === "na" ? "N/A" : "-"}</span></div>
        </div>`;
    });
    const people = s.byPerson.filter(p => p.memberId);
    const coached = people.filter(p => { const c = coachOf(a, p.memberId); return c.notes || c.commitment; });
    const pend = a.pending;
    const actions = [];
    if (st === "draft") { if (canEditDraft(a)) actions.push(`<a class="btn primary" href="#/edit/${esc(a.id)}">Continue</a>`); }
    else {
      actions.push(`<a class="btn ${st === "scored" ? "primary" : "ghost"}" href="#/coach/${esc(a.id)}">${st === "scored" ? "Log coaching" : "Update coaching log"}</a>`);
      if (can.admin) actions.push(`<a class="btn ghost" href="#/edit/${esc(a.id)}">Edit</a>`);
      else if (!(pend && pend.by !== Storage.me.email)) actions.push(`<a class="btn ghost" href="#/edit/${esc(a.id)}">${pend ? "Revise my request" : "Request a change"}</a>`);
    }
    actions.push(`<button class="btn ${st === "draft" ? "ghost" : "primary"}" id="btn-pdf">File PDF</button>`);
    if (can.del) actions.push(`<button class="btn danger" id="btn-del">Delete</button>`);
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / ${esc(a.id)}</nav>
      <section class="hero">
        <div><h1>${esc(a.fileRef || "Audit")} ${statusChip(a)}</h1>
          <p class="muted">${esc(auditLabel(a))}. ${esc(a.rto || "RTO not recorded")}${a.rtoCode ? " (" + esc(a.rtoCode) + ")" : ""}${a.complianceLevel ? ", " + esc(a.complianceLevel) : ""}, ${esc(compLabel(a.compliant).toLowerCase())}${a.qualification ? ". " + esc(a.qualification) : ""}. Received ${fmtDate(a.receivedDate)}, audited ${fmtDate(a.date)}${a.daysInPipeline !== null ? " (" + a.daysInPipeline + " days)" : ""} by ${esc(a.auditor || "-")}.${a.submitWait ? ` <span class="${a.submitWait.over ? "warn" : ""}">${a.submitWait.businessDays} business days ${esc(a.submitWait.label)} (allowed ${a.submitWait.allowed}).</span>` : ""}</p></div>
        <div class="hero-actions">${actions.join("")}</div>
      </section>
      ${pend ? `<section class="pending ${can.admin ? "" : "ro"}">
        <h3>Change request waiting${can.admin ? " for your decision" : ""}</h3>
        <p>${esc(pend.name || pend.by)} on ${fmtDate(String(pend.at).slice(0, 10))}. <strong>Reason:</strong> ${esc(pend.reason)}</p>
        <ul class="small">${pend.changes.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
        ${can.admin ? `<label>Note to the requester (optional) <input id="f-decide-note" type="text" placeholder="e.g. Agreed, the receipt was in the file."></label>
        <div class="row-actions"><button class="btn primary" id="btn-approve">Approve and apply</button> <button class="btn ghost" id="btn-reject">Reject</button></div>` : `<p class="muted small">Waiting for an admin or the owner. The scores below are unchanged until it is approved.</p>`}
      </section>` : ""}
      <div class="audit">
        <div class="audit-main">
          <div id="items" class="readonly">${html}</div>
          <h3>Coaching${a.coachingDate ? ` <span class="muted">${fmtDate(a.coachingDate)}</span>` : ""}</h3>
          ${st === "draft" ? `<p class="muted small">Coaching is logged once the audit is scored.</p>` : ""}
          <p class="coaching-ro">${a.coaching ? esc(a.coaching) : "<span class='muted'>No whole-file note.</span>"}</p>
          ${coached.length ? coached.map(p => { const c = coachOf(a, p.memberId); return `<div class="coach-ro"><strong>${esc(p.name)}</strong>${c.notes ? `<p><span class="muted small">Notes</span><br>${esc(c.notes)}</p>` : ""}${c.commitment ? `<p><span class="muted small">Commitment</span><br>${esc(c.commitment)}</p>` : ""}</div>`; }).join("") : (st !== "draft" ? `<p class="muted small">No per-person coaching logged yet.</p>` : "")}
          ${auditLog(a).length ? `<h3>History</h3><ul class="history">${auditLog(a).slice().reverse().map(logLine).join("")}</ul>` : ""}
        </div>
        <aside class="result-panel">
          <div class="score ${outcomeClass(s)}"><div class="big">${pct(s.score)}</div><div class="word">${esc(s.outcome)}</div>${s.criticalFail ? `<div class="why">Critical check failed</div>` : ""}</div>
          <dl class="tally"><div><dt>Pass</dt><dd>${s.passed}</dd></div><div><dt>Fail</dt><dd>${s.failed}</dd></div><div><dt>N/A</dt><dd>${s.na}</dd></div>${st === "draft" ? `<div><dt>Left</dt><dd>${s.unscored}</dd></div>` : ""}</dl>
          <div class="people-scores">${s.byPerson.map(p => `<div class="ps"><div>${p.memberId ? `<a href="#/member/${esc(p.memberId)}"><strong>${esc(p.name)}</strong></a>` : `<strong>${esc(p.name)}</strong>`}<span class="muted small">${esc(p.slots.join(", "))}</span>${p.memberId ? `<button class="link small" data-ppdf="${esc(p.memberId)}">Their copy (PDF)</button>` : ""}</div><div class="ps-r ${outcomeClass(p)}">${pct(p.score)}</div></div>`).join("")}</div>
          <p class="muted small">Their copy shows only that person's checks and score, plus the file result and their coaching log.${st === "draft" ? " While in progress the PDFs are marked as such." : ""}</p>
          <p class="muted small">Checks v${esc(a.criteriaVersion)}.${a.loggedBy ? ` Logged by ${esc(a.auditor || a.loggedBy)} (${esc(a.loggedBy)}).` : ""}</p>
        </aside>
      </div>`;
    if ($("#btn-pdf")) $("#btn-pdf").addEventListener("click", () => downloadPdf(a.id));
    view().querySelectorAll("[data-ppdf]").forEach(b => b.addEventListener("click", () => downloadPersonPdf(a.id, b.dataset.ppdf)));
    const decide = async (decision) => {
      if (!confirm(decision === "approve" ? "Approve and apply these changes?" : "Reject this change request?")) return;
      try { const rec = await Storage.decide(a.id, decision, $("#f-decide-note").value); records = records.filter(r => r.id !== rec.id).concat(rec); setStatus(decision === "approve" ? "Changes applied." : "Request rejected.", "ok"); renderAudit(a.id); }
      catch (err) { setStatus("Could not do that: " + err.message, "err"); }
    };
    if ($("#btn-approve")) $("#btn-approve").addEventListener("click", () => decide("approve"));
    if ($("#btn-reject")) $("#btn-reject").addEventListener("click", () => decide("reject"));
    if ($("#btn-del")) $("#btn-del").addEventListener("click", async () => {
      if (!confirm("Delete this audit? This cannot be undone.")) return;
      try { await Storage.remove(a.id); records = records.filter(r => r.id !== a.id); setStatus("Audit deleted.", "ok"); location.hash = "#/"; }
      catch (err) { setStatus("Could not delete: " + err.message, "err"); }
    });
  }

  // ---- coaching log (any auditor; scores stay as they are) ---------------
  function renderCoach(id) {
    const a = audits().find(x => x.id === id);
    if (!a) { view().innerHTML = `<p class="empty">Audit not found. <a href="#/">Back</a></p>`; return; }
    if (isDraft(a)) { view().innerHTML = `<p class="empty">Score the audit first. <a href="#/audit/${esc(a.id)}">Back</a></p>`; return; }
    const people = a.summary.byPerson.filter(p => p.memberId);
    const draft = { coaching: a.coaching || "", coachingDate: a.coachingDate || today(), coachingByPerson: {}, final: statusOf(a) === "final" };
    people.forEach(p => draft.coachingByPerson[p.memberId] = coachOf(a, p.memberId));
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / <a href="#/audit/${esc(a.id)}">${esc(a.fileRef || a.id)}</a> / Coaching</nav>
      <section class="hero"><div><h1>Coaching log ${statusChip(a)}</h1><p class="muted">${esc(a.fileRef)}: file result ${esc(a.summary.outcome)} (${pct(a.summary.score)}). Scores stay as they are here. If a score should change because of what came up in coaching, use ${can.admin ? "Edit" : "Request a change"} on the audit page.</p></div></section>
      <form id="coach-form" class="coach" autocomplete="off">
        <label>Coaching date <input id="c-date" type="date" value="${esc(draft.coachingDate)}" required></label>
        <label>Whole-file note <textarea id="c-note" rows="3" placeholder="File PDF only; can mention anyone.">${esc(draft.coaching)}</textarea></label>
        ${people.map(p => { const c = draft.coachingByPerson[p.memberId]; return `<div class="pn"><strong>${esc(p.name)}</strong> <span class="muted small">${esc(p.slots.join(", "))}, ${pct(p.score)} ${esc(p.outcome)}</span>
          <label>Coaching notes <textarea data-c="${esc(p.memberId)}" data-k="notes" rows="3" placeholder="What was discussed, what ${esc(p.name.split(" ")[0])} explained.">${esc(c.notes)}</textarea></label>
          <label>Commitment <textarea data-c="${esc(p.memberId)}" data-k="commitment" rows="2" placeholder="What ${esc(p.name.split(" ")[0])} agreed to change, by when.">${esc(c.commitment)}</textarea></label></div>`; }).join("")}
        <label class="check"><input id="c-final" type="checkbox" ${draft.final ? "checked" : ""}> Coaching done: mark this audit final</label>
        <div class="row-actions"><button type="submit" class="btn primary">Save coaching log</button> <a class="btn ghost" href="#/audit/${esc(a.id)}">Cancel</a></div>
        <p class="muted small">Each person's notes and commitment go on their own copy only. Every save is listed in the audit history.</p>
      </form>`;
    $("#coach-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const rec = { ...a, coaching: $("#c-note").value.trim(), coachingDate: $("#c-date").value, status: $("#c-final").checked ? "final" : "scored", coachingByPerson: {} };
      view().querySelectorAll("textarea[data-c]").forEach(t => { const c = rec.coachingByPerson[t.dataset.c] || (rec.coachingByPerson[t.dataset.c] = { notes: "", commitment: "" }); c[t.dataset.k] = t.value.trim(); });
      Object.keys(rec.coachingByPerson).forEach(k => { const c = rec.coachingByPerson[k]; if (!c.notes && !c.commitment) delete rec.coachingByPerson[k]; });
      try { const saved = await persistAudit(a, rec); const out = saved && saved.id ? saved : rec; records = records.filter(r => r.id !== out.id).concat(out); setStatus(out.status === "final" ? "Coaching logged. Audit is final." : "Coaching logged.", "ok"); location.hash = "#/audit/" + a.id; }
      catch (err) { setStatus("Could not save: " + err.message, "err"); }
    });
  }

  // ---- team (admin+) ----------------------------------------------------
  function renderTeam() {
    const list = records.filter(r => r.type === "member").sort((a, b) => a.name.localeCompare(b.name));
    if (!can.admin) {
      view().innerHTML = `
        <nav class="crumbs"><a href="#/">Team</a> / Team members</nav>
        <section class="hero"><div><h1>Team members</h1><p class="muted">Only an admin can add, change or remove team members.</p></div></section>
        <div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Roles</th><th>Audits</th></tr></thead>
        <tbody>${list.filter(m => !m.archived).map(m => `<tr><td>${esc(m.name)}</td><td>${esc(rolesOf(m).join(", "))}</td><td>${auditsFor(m.id).length}</td></tr>`).join("")}</tbody></table></div>`;
      return;
    }
    const roleChecks = (m, prefix) => roleNames().map(r => `<label class="chk"><input type="checkbox" data-${prefix}="${esc(m ? m.id : "new")}" value="${esc(r)}" ${m && rolesOf(m).includes(r) ? "checked" : ""}> ${esc(r)}</label>`).join("");
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / Manage team</nav>
      <section class="hero">
        <div><h1>Manage team</h1><p class="muted">Team members are the people whose work gets audited. They don't need a login. Roles decide who is prefilled on each part of a file; a person can hold several. People with audits can only be archived, so their history stays.</p></div>
        <div class="hero-actions"><a class="btn ghost" href="#/roles">Manage roles</a>${can.owner ? `<a class="btn ghost" href="#/users">Logins</a>` : ""}</div>
      </section>
      <form id="member-form" class="member-form" autocomplete="off">
        <input id="m-name" type="text" placeholder="Full name" required>
        <div class="chk-row">${roleChecks(null, "newrole")}</div>
        <button class="btn primary" type="submit">Add member</button>
      </form>
      <div class="table-wrap"><table class="list">
        <thead><tr><th>Name</th><th>Roles</th><th>Audits</th><th></th></tr></thead>
        <tbody>${list.map(m => { const n = auditsFor(m.id).length; return `<tr class="${m.archived ? "dim" : ""}">
          <td>${esc(m.name)}${m.archived ? " <span class='muted small'>(archived)</span>" : ""}</td>
          <td><div class="chk-row">${roleChecks(m, "role")}</div></td>
          <td>${n}</td>
          <td class="row-actions"><button class="link" data-rename="${esc(m.id)}">Rename</button> <button class="link" data-arch="${esc(m.id)}">${m.archived ? "Restore" : "Archive"}</button>${n ? "" : ` <button class="link danger-link" data-delm="${esc(m.id)}">Delete</button>`}</td>
        </tr>`; }).join("")}</tbody>
      </table></div>`;

    $("#member-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const roles = [...view().querySelectorAll("input[data-newrole]:checked")].map(c => c.value);
      const rec = { id: uid("M"), type: "member", name: $("#m-name").value.trim(), roles, archived: false, createdAt: new Date().toISOString() };
      try { await Storage.save(rec); records.push(rec); setStatus("Added " + rec.name + ".", "ok"); renderTeam(); }
      catch (err) { setStatus("Could not save: " + err.message, "err"); }
    });
    const update = async (m, changes, msg) => {
      const next = { ...m, ...changes }; delete next.role;
      try { await Storage.save(next); Object.assign(m, changes); delete m.role; setStatus(msg, "ok"); renderTeam(); }
      catch (err) { setStatus("Could not save: " + err.message, "err"); renderTeam(); }
    };
    view().querySelectorAll("input[data-role]").forEach(c => c.addEventListener("change", () => {
      const m = memberById(c.dataset.role);
      const roles = [...view().querySelectorAll(`input[data-role="${c.dataset.role}"]:checked`)].map(x => x.value);
      update(m, { roles }, "Roles updated.");
    }));
    view().querySelectorAll("[data-rename]").forEach(b => b.addEventListener("click", () => { const m = memberById(b.dataset.rename); const name = prompt("New name", m.name); if (name && name.trim()) update(m, { name: name.trim() }, "Renamed."); }));
    view().querySelectorAll("[data-arch]").forEach(b => b.addEventListener("click", () => { const m = memberById(b.dataset.arch); update(m, { archived: !m.archived }, m.archived ? "Restored." : "Archived."); }));
    view().querySelectorAll("[data-delm]").forEach(b => b.addEventListener("click", async () => {
      const m = memberById(b.dataset.delm);
      if (!confirm("Delete " + m.name + "? They have no audits.")) return;
      try { await Storage.remove(m.id); records = records.filter(r => r.id !== m.id); setStatus("Deleted " + m.name + ".", "ok"); renderTeam(); }
      catch (err) { setStatus("Could not delete: " + err.message, "err"); }
    }));
  }

  // ---- roles (admin+) ---------------------------------------------------
  const SLOT_LABELS = { intake: "Intake", drafting: "Drafting", review: "Review and submission (generic files)", compliant: "Review and submission (compliant-college files)", lead: "Admin Lead decisions", posting: "Posting", cancel: "Cancellation", none: "Nothing (not prefilled)" };
  function renderRoles() {
    if (!can.admin) { view().innerHTML = `<p class="empty">Only an admin can manage roles. <a href="#/">Back</a></p>`; return; }
    const inUse = (name) => records.filter(r => r.type === "member" && rolesOf(r).includes(name)).length;
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / <a href="#/team">Manage team</a> / Roles</nav>
      <section class="hero"><div><h1>Job roles</h1><p class="muted">A role is what a person does on files. "Prefills" says which part of a file the app fills in with the first person holding the role; the auditor can always change it.</p></div></section>
      <form id="role-form" class="inline-form" autocomplete="off">
        <input id="r-name" type="text" placeholder="Role name" required>
        <select id="r-slot">${Object.entries(SLOT_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
        <button class="btn primary" type="submit">Add role</button>
      </form>
      <div class="table-wrap"><table class="list">
        <thead><tr><th>Role</th><th>Prefills</th><th>People</th><th></th></tr></thead>
        <tbody>${Storage.roles.map((r, i) => `<tr>
          <td>${esc(r.name)}</td>
          <td><select data-rslot="${i}">${Object.entries(SLOT_LABELS).map(([k, v]) => `<option value="${k}" ${k === r.slot ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></td>
          <td>${inUse(r.name)}</td>
          <td class="row-actions"><button class="link" data-rrename="${i}">Rename</button>${inUse(r.name) ? "" : ` <button class="link danger-link" data-rdel="${i}">Delete</button>`}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
    const save = async (next, msg) => { try { await Storage.setRoles(next); setStatus(msg, "ok"); renderRoles(); } catch (err) { setStatus(err.message, "err"); renderRoles(); } };
    $("#role-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#r-name").value.trim(); if (!name) return;
      if (Storage.roles.some(r => r.name.toLowerCase() === name.toLowerCase())) { setStatus("That role already exists.", "err"); return; }
      save([...Storage.roles, { name, slot: $("#r-slot").value }], "Role added.");
    });
    view().querySelectorAll("[data-rslot]").forEach(sel => sel.addEventListener("change", () => { const next = Storage.roles.map((r, i) => i === Number(sel.dataset.rslot) ? { ...r, slot: sel.value } : r); save(next, "Updated."); }));
    view().querySelectorAll("[data-rrename]").forEach(b => b.addEventListener("click", async () => {
      const i = Number(b.dataset.rrename); const old = Storage.roles[i].name;
      const name = prompt("New role name", old); if (!name || !name.trim() || name.trim() === old) return;
      // rename on every member that holds it
      const members = records.filter(r => r.type === "member" && rolesOf(r).includes(old));
      try {
        for (const m of members) { const next = { ...m, roles: rolesOf(m).map(x => x === old ? name.trim() : x) }; delete next.role; await Storage.save(next); m.roles = next.roles; delete m.role; }
        await save(Storage.roles.map((r, j) => j === i ? { ...r, name: name.trim() } : r), "Renamed on " + members.length + " people.");
      } catch (err) { setStatus(err.message, "err"); }
    }));
    view().querySelectorAll("[data-rdel]").forEach(b => b.addEventListener("click", () => { if (confirm("Delete this role?")) save(Storage.roles.filter((r, i) => i !== Number(b.dataset.rdel)), "Role deleted."); }));
  }

  // ---- logins (owner) ---------------------------------------------------
  function renderUsers() {
    if (!cloud()) { view().innerHTML = `<p class="empty">Logins only exist on the live site. <a href="#/">Back</a></p>`; return; }
    if (!can.owner) { view().innerHTML = `<p class="empty">Only the owner can manage logins. <a href="#/">Back</a></p>`; return; }
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / Logins</nav>
      <section class="hero"><div><h1>Logins</h1><p class="muted">Only the people who audit need a login. You create it, pass on the temporary password, and they set their own at first sign-in. Access levels: <b>Admin</b> can delete audits and manage the team and roles. <b>Auditor</b> can view and add audits.</p></div></section>
      <form id="user-form" class="inline-form" autocomplete="off">
        <input id="u-name" type="text" placeholder="Full name" required>
        <input id="u-email" type="text" placeholder="name@atsrpl.com.au" required>
        <select id="u-level"><option value="auditor">Auditor</option><option value="admin">Admin</option></select>
        <button class="btn primary" type="submit">Create login</button>
      </form>
      <div id="temp-box" hidden></div>
      <div class="table-wrap"><table class="list" id="user-table"><tbody><tr><td class="muted">Loading...</td></tr></tbody></table></div>`;
    const showTemp = (email, pw) => { const b = $("#temp-box"); b.hidden = false; b.className = "temp-box"; b.innerHTML = `<strong>Temporary password for ${esc(email)}</strong><code>${esc(pw)}</code><p class="muted small">Shown once. Pass it on; they will be asked to choose their own password at first sign-in.</p>`; };
    async function load() {
      let users; try { users = await Storage.listUsers(); } catch (err) { setStatus(err.message, "err"); return; }
      $("#user-table").innerHTML = `
        <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map(u => `<tr class="${u.disabled ? "dim" : ""}">
          <td>${esc(u.name)}</td><td>${esc(u.email)}</td>
          <td>${u.level === "owner" ? "Owner" : `<select data-ulevel="${esc(u.id)}"><option value="auditor" ${u.level === "auditor" ? "selected" : ""}>Auditor</option><option value="admin" ${u.level === "admin" ? "selected" : ""}>Admin</option></select>`}</td>
          <td>${u.lastLogin ? fmtDate(u.lastLogin.slice(0, 10)) : "Never"}</td>
          <td>${u.disabled ? `<span class="badge fail">Disabled</span>` : u.mustChange ? `<span class="badge coach">Temp password</span>` : `<span class="badge pass">Active</span>`}</td>
          <td class="row-actions"><button class="link" data-urename="${esc(u.id)}">Rename</button> ${u.level === "owner" && u.id === Storage.me.id ? "" : `<button class="link" data-ureset="${esc(u.id)}">Reset password</button> <button class="link ${u.disabled ? "" : "danger-link"}" data-udis="${esc(u.id)}" data-now="${u.disabled ? 1 : 0}">${u.disabled ? "Enable" : "Disable"}</button>`}</td>
        </tr>`).join("")}</tbody>`;
      view().querySelectorAll("[data-ulevel]").forEach(sel => sel.addEventListener("change", async () => { try { await Storage.updateUser(sel.dataset.ulevel, { level: sel.value }); setStatus("Access level updated.", "ok"); } catch (err) { setStatus(err.message, "err"); load(); } }));
      view().querySelectorAll("[data-urename]").forEach(b => b.addEventListener("click", async () => {
        const u = users.find(x => x.id === b.dataset.urename); const name = prompt("Name as it should appear on audits and PDFs", u.name);
        if (!name || !name.trim() || name.trim() === u.name) return;
        try { await Storage.updateUser(u.id, { name: name.trim() }); setStatus("Renamed.", "ok"); if (u.id === Storage.me.id) { Storage.me.name = name.trim(); applyNav(); } load(); } catch (err) { setStatus(err.message, "err"); }
      }));
      view().querySelectorAll("[data-ureset]").forEach(b => b.addEventListener("click", async () => {
        const u = users.find(x => x.id === b.dataset.ureset);
        if (!confirm("Reset the password for " + u.email + "? They will be signed out and must set a new one.")) return;
        try { const r = await Storage.resetUser(u.id); showTemp(u.email, r.tempPassword); load(); } catch (err) { setStatus(err.message, "err"); }
      }));
      view().querySelectorAll("[data-udis]").forEach(b => b.addEventListener("click", async () => {
        const u = users.find(x => x.id === b.dataset.udis); const disable = b.dataset.now === "0";
        if (disable && !confirm("Disable " + u.email + "? They will be signed out and cannot sign in until enabled.")) return;
        try { await Storage.updateUser(u.id, { disabled: disable }); setStatus(disable ? "Disabled." : "Enabled.", "ok"); load(); } catch (err) { setStatus(err.message, "err"); }
      }));
    }
    $("#user-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await Storage.createUser({ name: $("#u-name").value.trim(), email: $("#u-email").value.trim(), level: $("#u-level").value });
        $("#u-name").value = ""; $("#u-email").value = ""; showTemp(r.user.email, r.tempPassword); setStatus("Login created.", "ok"); load();
      } catch (err) { setStatus(err.message, "err"); }
    });
    load();
  }

  // ---- sign in / account ------------------------------------------------
  function renderLogin(message) {
    document.body.classList.add("auth");
    view().innerHTML = `
      <section class="auth-card">
        <h1>Sign in</h1>
        <p class="muted">B2B QA Audit. Use the email and password the owner gave you.</p>
        ${message ? `<p class="warn small">${esc(message)}</p>` : ""}
        <form id="login-form" autocomplete="on">
          <label>Email <input id="l-email" type="email" autocomplete="username" required></label>
          <label>Password <input id="l-pass" type="password" autocomplete="current-password" required></label>
          <button class="btn primary block" type="submit">Sign in</button>
        </form>
        <p class="muted small">Forgot your password? Ask the owner to reset it.</p>
      </section>`;
    $("#l-email").focus();
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#login-form button"); btn.disabled = true;
      try { await Storage.login($("#l-email").value.trim(), $("#l-pass").value); await boot(); }
      catch (err) { btn.disabled = false; renderLogin(err.message); }
    });
  }
  function renderPassword(forced) {
    view().innerHTML = `
      ${forced ? "" : `<nav class="crumbs"><a href="#/">Team</a> / Account</nav>`}
      <section class="auth-card">
        <h1>${forced ? "Choose your password" : "Account"}</h1>
        <p class="muted">${forced ? "You signed in with a temporary password. Set your own to continue." : `Signed in as ${esc(Storage.me.name)}, ${esc(Storage.me.email)} (${esc(Storage.me.level)}).`}</p>
        <form id="pw-form" autocomplete="on">
          <label>Current password <input id="p-cur" type="password" autocomplete="current-password" required></label>
          <label>New password (at least 10 characters) <input id="p-new" type="password" autocomplete="new-password" minlength="10" required></label>
          <label>New password again <input id="p-new2" type="password" autocomplete="new-password" minlength="10" required></label>
          <button class="btn primary block" type="submit">Save password</button>
        </form>
        ${forced ? `<button class="btn ghost block" id="btn-signout">Sign out</button>` : `<button class="btn ghost block" id="btn-signout">Sign out</button>`}
      </section>`;
    $("#pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if ($("#p-new").value !== $("#p-new2").value) { setStatus("The two new passwords don't match.", "err"); return; }
      try { await Storage.changePassword($("#p-cur").value, $("#p-new").value); setStatus("Password saved.", "ok"); if (forced) await boot(); else location.hash = "#/"; }
      catch (err) { setStatus(err.message, "err"); }
    });
    $("#btn-signout").addEventListener("click", signOut);
  }
  async function signOut() { await Storage.logout(); records = []; location.hash = "#/"; ctx.state = "login"; renderLogin(); }

  // ---- criteria view ------------------------------------------------------
  function renderCriteria() {
    const tag = (it) => [it.for === "all" ? "" : compLabel(it.for === "compliant") + " only", it.cancelled ? "" : "from " + (CRITERIA.stages.find(s => s.rank === it.from)?.name || it.from), it.only ? "only at " + it.only.map(l => stageByLetter(l).name).join(", ") : "", it.cancelled ? "cancelled files only" : ""].filter(Boolean).join(", ");
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / Checks</nav>
      <section class="hero"><div><h1>Checks v${esc(CRITERIA.version)}</h1><p class="muted">Read-only view of js/criteria.js. ${CRITERIA.items.length} checks, ${CRITERIA.items.filter(i => i.critical).length} critical. Based on the ${esc(CRITERIA.manual)}.</p></div></section>
      ${CRITERIA.phases.map(ph => { const its = CRITERIA.items.filter(i => i.phase === ph.id); return its.length ? `
        <details class="card-def" open>
          <summary><strong>${esc(ph.title)}</strong> <span class="muted">${esc(ph.sop)}, ${its.length} checks</span></summary>
          <ol class="def-list">${its.map(it => `<li>${esc(it.text)} <span class="ref">${esc(it.id)}, ${esc(it.ref)}. Owner: ${esc(typeof it.owner === "string" ? slotById(it.owner).label : "Admin Lead (generic) / Review and submission (college-specific)")}. ${esc(tag(it))}</span>${it.critical ? `<span class="crit">Critical</span>` : ""}</li>`).join("")}</ol>
        </details>` : ""; }).join("")}`;
  }

  // ---- backup -------------------------------------------------------------
  function renderData() {
    if (cloud() && !can.owner) { view().innerHTML = `<p class="empty">Only the owner can export data. <a href="#/">Back</a></p>`; return; }
    const isCloud = cloud();
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / Backup</nav>
      <section class="hero"><div><h1>Backup</h1><p class="muted">${isCloud ? "Everything is stored on the server. Export a copy from time to time as an extra backup." : "This copy keeps records in this browser only. Export a JSON backup regularly."}</p></div></section>
      <div class="hero-actions"><button class="btn primary" id="btn-export">Export JSON</button>${isCloud ? `<button class="btn ghost" id="btn-full">Full export (for moving servers)</button>` : `<label class="btn ghost">Import JSON <input type="file" id="btn-import" accept="application/json" hidden></label>`}</div>
      <p class="muted small">${records.length} records (${records.filter(r => r.type === "member").length} members, ${records.filter(r => r.type === "audit").length} audits).</p>
      ${isCloud ? `<p class="muted small">Full export includes logins (password hashes), deleted audits and roles. Keep the file private. It is what server/import.mjs loads on a new server.</p>` : ""}`;
    const save = (data, name) => { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
    $("#btn-export").addEventListener("click", () => save(records, "atsr-qa-backup-" + today() + ".json"));
    if (isCloud) {
      $("#btn-full").addEventListener("click", async () => {
        try { const data = await Storage.fullExport(); save(data, "atsr-qa-full-export-" + today() + ".json"); setStatus("Full export downloaded: " + data.users.length + " logins, " + data.records.length + " records.", "ok"); }
        catch (err) { setStatus("Export failed: " + err.message, "err"); }
      });
      return;
    }
    $("#btn-import").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const data = JSON.parse(await file.text()); if (!Array.isArray(data)) throw new Error("Not a backup file."); if (!confirm("Replace everything in this browser with " + data.length + " records from the file?")) return; await Storage.replaceAll(data); records = data; setStatus("Imported.", "ok"); location.hash = "#/"; }
      catch (err) { setStatus("Import failed: " + err.message, "err"); }
    });
  }

  // ---- pdf ----------------------------------------------------------------
  function downloadPdf(id) {
    const a = audits().find(x => x.id === id); if (!a) return;
    if (!window.jspdf) { setStatus("PDF library not loaded. Check your connection.", "err"); return; }
    try { buildAuditPdf(a, window.jspdf.jsPDF, typeof ATSR_LOGO !== "undefined" ? ATSR_LOGO : null).save(auditPdfFilename(a)); }
    catch (err) { console.error(err); setStatus("PDF failed: " + err.message, "err"); }
  }

  function downloadPersonPdf(auditId, memberId) {
    const a = audits().find(x => x.id === auditId); if (!a) return;
    if (!window.jspdf) { setStatus("PDF library not loaded. Check your connection.", "err"); return; }
    const p = a.summary.byPerson.find(x => x.memberId === memberId);
    try { buildPersonPdf(a, memberId, window.jspdf.jsPDF, typeof ATSR_LOGO !== "undefined" ? ATSR_LOGO : null).save(personPdfFilename(a, p ? p.name : memberId)); }
    catch (err) { console.error(err); setStatus("PDF failed: " + err.message, "err"); }
  }

  // ---- router -------------------------------------------------------------
  function route() {
    if (ctx.state === "login") return renderLogin();
    if (ctx.state === "mustChange") return renderPassword(true);
    document.body.classList.remove("auth");
    const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
    window.scrollTo(0, 0);
    if (page === "member" && arg) return renderMember(arg);
    if (page === "new") return renderNew();
    if (page === "edit" && arg) return renderNew(arg);
    if (page === "coach" && arg) return renderCoach(arg);
    if (page === "audit" && arg) return renderAudit(arg);
    if (page === "team") return renderTeam();
    if (page === "roles") return renderRoles();
    if (page === "users") return renderUsers();
    if (page === "account") return renderPassword(false);
    if (page === "criteria") return renderCriteria();
    if (page === "data") return renderData();
    return renderHome();
  }

  function applyNav() {
    document.querySelectorAll(".topbar nav a.main").forEach(a => a.hidden = ctx.state !== "ready");
    const nav = document.getElementById("nav-team"); if (nav) nav.textContent = can.admin ? "Manage team" : "Team members";
    const acc = document.getElementById("nav-account");
    if (acc) { acc.hidden = !cloud() || ctx.state !== "ready"; acc.textContent = Storage.me.name || "Account"; }
    const users = document.getElementById("nav-users"); if (users) users.hidden = !(cloud() && can.owner && ctx.state === "ready");
  }

  async function boot() {
    try {
      const b = await Storage.init();
      ctx.state = b.state;
      if (b.state === "ready") {
        ctx.master = b.master || ctx.master; ctx.notes = b.collegeNotes || {};
        records = (b.records || []).filter(r => r.type !== "audit" || r.itemIds);
        records.forEach(r => { if (r.type === "member" && !Array.isArray(r.roles)) r.roles = r.role ? [r.role] : []; });
        if (can.admin && !records.some(r => r.type === "member") && CONFIG.TEAM_SEED.length) {
          for (const t of CONFIG.TEAM_SEED) { const rec = { id: uid("M"), type: "member", name: t.name, roles: t.roles || (t.role ? [t.role] : []), archived: false, createdAt: new Date().toISOString() }; await Storage.save(rec); records.push(rec); }
        }
      }
    } catch (err) { view().innerHTML = `<p class="empty">Could not load: ${esc(err.message)}</p>`; return; }
    applyNav();
    route();
  }

  document.getElementById("nav-signout")?.addEventListener("click", (e) => { e.preventDefault(); signOut(); });
  window.addEventListener("hashchange", route);
  boot();
})();
