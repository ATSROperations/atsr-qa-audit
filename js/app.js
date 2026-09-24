/* ATSR B2B QA Audit - app logic. Vanilla JS, hash routing, no build step. */

(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const uid = (prefix) => prefix + "-" + today().replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6);
  const pct = (x) => x === null || x === undefined ? "-" : Math.round(x * 100) + "%";
  const fmtDate = (iso) => { if (!iso) return "-"; const [y, m, d] = iso.split("-"); return d + "/" + m + "/" + y; };
  const daysBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;

  const stageByLetter = (l) => CRITERIA.stages.find(s => s.letter === l);
  const phaseById = (id) => CRITERIA.phases.find(p => p.id === id);
  const slotById = (id) => CRITERIA.slots.find(s => s.id === id);
  const compKey = (compliant) => compliant ? "compliant" : "noncompliant";
  const ownerOf = (item, ck) => typeof item.owner === "string" ? item.owner : item.owner[ck];
  const itemById = (id) => CRITERIA.items.find(i => i.id === id);

  // Checks in scope for a file at this stage with this compliance status, in phase order.
  function scopeItems(stageLetter, compliant) {
    const st = stageByLetter(stageLetter); if (!st) return [];
    const ck = compKey(compliant);
    const order = CRITERIA.phases.map(p => p.id);
    return CRITERIA.items
      .filter(it => it.from <= st.rank && (!it.only || it.only.includes(stageLetter)) && (it.for === "all" || it.for === ck))
      .sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));
  }
  const slotsInScope = (items, ck) => CRITERIA.slots.filter(s => items.some(it => ownerOf(it, ck) === s.id));

  let records = [];
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
  function computeSummary(items, results, compliant, people) {
    const ck = compKey(compliant);
    const overall = tally(items, results);
    // group slots by the person holding them
    const byPerson = [];
    CRITERIA.slots.forEach(slot => {
      const its = items.filter(it => ownerOf(it, ck) === slot.id);
      if (!its.length) return;
      const memberId = people[slot.id] || null;
      const key = memberId || "unassigned-" + slot.id;
      let p = byPerson.find(x => x.key === key);
      if (!p) { const m = memberId ? memberById(memberId) : null; p = { key, memberId, name: m ? m.name : "Unassigned", slots: [], items: [] }; byPerson.push(p); }
      p.slots.push(slot.label); p.items.push(...its);
    });
    byPerson.forEach(p => { Object.assign(p, tally(p.items, results)); delete p.items; });
    return { ...overall, byPerson };
  }
  const outcomeClass = (s) => s.criticalFail ? "fail" : s.outcome === "Pass" ? "pass" : s.outcome === "Needs coaching" ? "coach" : s.outcome === "Fail" ? "fail" : "none";
  const badge = (s) => `<span class="badge ${outcomeClass(s)}">${esc(s.outcome)}${s.criticalFail ? " (critical)" : ""}</span>`;

  function memberStats(memberId) {
    const list = auditsFor(memberId).map(a => ({ audit: a, mine: a.summary.byPerson.find(p => p.memberId === memberId) }));
    const scored = list.slice(0, 5).filter(x => x.mine.score !== null);
    const avg = scored.length ? scored.reduce((t, x) => t + x.mine.score, 0) / scored.length : null;
    return { count: list.length, last: list[0] || null, avg, criticals: list.filter(x => x.mine.criticalFail).length };
  }

  // ---- shell --------------------------------------------------------------
  const view = () => $("#view");
  function setStatus(msg, kind = "") {
    const el = $("#status"); el.textContent = msg; el.className = "status " + kind;
    if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ""; el.className = "status"; } }, 3500);
  }
  const auditLabel = (a) => (a.auditType === "completed" ? "Completed" : "Ongoing") + " at " + (stageByLetter(a.stage)?.name || a.stage);
  const compLabel = (c) => c ? "Compliant" : "Non-compliant";

  // ---- home ---------------------------------------------------------------
  function renderHome() {
    const list = members();
    const recent = audits().slice(0, 8);
    view().innerHTML = `
      <section class="hero">
        <div>
          <h1>Team</h1>
          <p class="muted">Audits are of files: a completed file end to end, or a live file at its current stage. Each person's score is built from the checks they were answerable for.</p>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="#/new">New audit</a>
          <a class="btn ghost" href="#/team">Manage team</a>
          <a class="btn ghost" href="#/criteria">View checks</a>
        </div>
      </section>

      <section class="cards">
        ${list.length ? list.map(m => {
          const st = memberStats(m.id);
          return `
          <article class="member">
            <div class="member-head">
              <div><h2><a href="#/member/${esc(m.id)}">${esc(m.name)}</a></h2><div class="role">${esc(m.role)}</div></div>
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
        }).join("") : `<p class="empty">No team members yet. <a href="#/team">Add the team</a> to start.</p>`}
      </section>

      <section class="two-col">
        <div>
          <h3>Recent audits</h3>
          ${recent.length ? `<div class="table-wrap"><table class="list">
            <thead><tr><th>Audited</th><th>File</th><th>Type</th><th>RTO</th><th>Score</th><th>Outcome</th></tr></thead>
            <tbody>${recent.map(a => `<tr onclick="location.hash='#/audit/${esc(a.id)}'">
              <td>${fmtDate(a.date)}</td><td>${esc(a.fileRef || "-")}</td><td>${esc(auditLabel(a))}</td>
              <td>${esc(a.rtoShort || a.rto || "-")} <span class="muted small">${esc(compLabel(a.compliant))}</span></td>
              <td>${pct(a.summary.score)}</td><td>${badge(a.summary)}</td></tr>`).join("")}</tbody>
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
          <p class="muted small">Storage: ${Storage.mode === "local" ? "this browser only (set WEBHOOK_URL in config.js to share)" : "shared endpoint"}.${Storage.mode === "local" ? ' <a href="#/data">Backup</a>' : ""}</p>
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
        <div><h1>${esc(m.name)}</h1><p class="muted">${esc(m.role)}${m.archived ? " (archived)" : ""}</p></div>
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
          <td>${esc(p.slots.join(", "))}</td><td>${pct(p.score)}</td><td>${badge(p)}</td><td>${badge(a.summary)}</td>
          <td class="row-actions"><a href="#/audit/${esc(a.id)}">Open</a> <button class="link" data-pdf="${esc(a.id)}">PDF</button></td></tr>`; }).join("")}</tbody>
      </table></div>` : `<p class="muted">No audits yet for ${esc(m.name)}.</p>`}`;
    view().querySelectorAll("[data-pdf]").forEach(b => b.addEventListener("click", () => downloadPdf(b.dataset.pdf)));
  }

  // ---- new audit ----------------------------------------------------------
  function renderNew() {
    const team = members();
    if (!team.length) { view().innerHTML = `<p class="empty">Add the team first. <a href="#/team">Manage team</a></p>`; return; }

    const draft = {
      auditType: "completed", stage: "G", fileRef: "", receivedDate: "", date: today(),
      auditor: localStorage.getItem("atsr_qa_auditor") || "",
      rtoIndex: CONFIG.RTOS.length ? "0" : "other", rtoOther: "", compliant: CONFIG.RTOS.length ? !!CONFIG.RTOS[0].compliant : false,
      qualification: "", people: {}, results: {}, coaching: "",
    };
    const rtoName = () => draft.rtoIndex === "other" ? draft.rtoOther.trim() : CONFIG.RTOS[Number(draft.rtoIndex)].name;
    const rtoShort = () => draft.rtoIndex === "other" ? draft.rtoOther.trim() : (CONFIG.RTOS[Number(draft.rtoIndex)].short || CONFIG.RTOS[Number(draft.rtoIndex)].name);
    const rtoNotes = () => draft.rtoIndex === "other" ? [] : (CONFIG.RTOS[Number(draft.rtoIndex)].notes || []);
    const firstByRole = (role) => team.find(m => m.role === role);
    function defaultPeople() {
      const ck = compKey(draft.compliant); const p = {};
      CRITERIA.slots.forEach(s => {
        const role = typeof s.defaultRole === "string" ? s.defaultRole : s.defaultRole[ck];
        const m = role ? firstByRole(role) : null;
        p[s.id] = draft.people[s.id] || (m ? m.id : "");
      });
      return p;
    }
    draft.people = defaultPeople();

    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / New audit</nav>
      <section class="hero"><div><h1>New audit</h1><p class="muted">Fill in the file first. The checks below adjust to the audit type, the stage and the college.</p></div></section>
      <form id="audit-form" class="audit" autocomplete="off">
        <div class="audit-main">
          <div class="head-block">
            <div class="seg wide" role="group" aria-label="Audit type">
              <button type="button" data-type="completed" class="on">Completed file (end to end)</button>
              <button type="button" data-type="ongoing">Ongoing file (at its current stage)</button>
            </div>
            <div class="meta-grid three">
              <label>Stage at audit <select id="f-stage"></select></label>
              <label>File / opportunity <input id="f-file" type="text" placeholder="e.g. Anita Sharma_CHC40221" required></label>
              <label>Qualification <input id="f-qual" type="text" placeholder="e.g. CHC40221"></label>
              <label>File received <input id="f-received" type="date" required></label>
              <label>Audit date <input id="f-date" type="date" value="${today()}" required></label>
              <label>Auditor <input id="f-auditor" type="text" value="${esc(draft.auditor)}" placeholder="Your name" required></label>
              <label>RTO / college
                <select id="f-rto">${CONFIG.RTOS.map((r, i) => `<option value="${i}">${esc(r.short ? r.short + " - " + r.name : r.name)}</option>`).join("")}<option value="other">Other (type it)</option></select>
              </label>
              <label id="rto-other-wrap" hidden>RTO name <input id="f-rto-other" type="text" placeholder="RTO name"></label>
              <label>College type
                <select id="f-comp"><option value="1">Compliant</option><option value="0">Non-compliant</option></select>
              </label>
            </div>
            <div id="people" class="people"></div>
            <p id="days" class="muted small"></p>
          </div>
          <div id="reminders"></div>
          <div id="items"></div>
          <label class="coaching">Coaching note / agreed action
            <textarea id="f-coaching" rows="3" placeholder="What was discussed, with whom, what changes, by when."></textarea>
          </label>
        </div>
        <aside class="result-panel" id="result-panel"></aside>
      </form>`;

    // ---- header wiring
    function fillStages() {
      const sel = $("#f-stage");
      const opts = CRITERIA.stages.filter(s => s.type === draft.auditType);
      if (!opts.some(s => s.letter === draft.stage)) draft.stage = opts[opts.length - 1].letter;
      sel.innerHTML = opts.map(s => `<option value="${s.letter}" ${s.letter === draft.stage ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    }
    function fillPeople() {
      const items = scopeItems(draft.stage, draft.compliant);
      const slots = slotsInScope(items, compKey(draft.compliant));
      $("#people").innerHTML = `<div class="people-title">Who handled this file</div><div class="people-grid">` +
        slots.map(s => `<label>${esc(s.label)}<select data-slot="${s.id}"><option value="">Unassigned</option>${team.map(m => `<option value="${m.id}" ${draft.people[s.id] === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>`).join("") + `</div>`;
      $("#people").querySelectorAll("select[data-slot]").forEach(sel => sel.addEventListener("change", () => { draft.people[sel.dataset.slot] = sel.value; renderItems(); }));
    }
    function fillDays() {
      const d = daysBetween(draft.receivedDate, draft.date);
      $("#days").textContent = d === null ? "" : d + " days from file received to audit date.";
    }
    function fillReminders() {
      const ck = compKey(draft.compliant);
      const notes = draft.compliant ? rtoNotes() : [];
      $("#reminders").innerHTML = `
        ${draft.compliant ? `<div class="remind college"><strong>${esc(rtoShort() || "College")} process notes</strong>${notes.length ? `<ul>${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="muted small">No notes recorded for this college yet. Add them in config.js under RTOS.</p>`}</div>` : ""}
        <div class="remind"><strong>Follow-up cadence, ${esc(compLabel(draft.compliant).toLowerCase())} file</strong><ul>${(CONFIG.CADENCE[ck] || []).map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
    }

    $("#audit-form").querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => {
      draft.auditType = b.dataset.type;
      $("#audit-form").querySelectorAll("[data-type]").forEach(x => x.classList.toggle("on", x === b));
      fillStages(); fillPeople(); renderItems();
    }));
    $("#f-stage").addEventListener("change", e => { draft.stage = e.target.value; fillPeople(); renderItems(); });
    $("#f-file").addEventListener("input", e => draft.fileRef = e.target.value);
    $("#f-qual").addEventListener("input", e => draft.qualification = e.target.value);
    $("#f-received").addEventListener("change", e => { draft.receivedDate = e.target.value; fillDays(); });
    $("#f-date").addEventListener("change", e => { draft.date = e.target.value; fillDays(); });
    $("#f-auditor").addEventListener("input", e => draft.auditor = e.target.value);
    $("#f-rto").addEventListener("change", e => {
      draft.rtoIndex = e.target.value;
      $("#rto-other-wrap").hidden = draft.rtoIndex !== "other";
      if (draft.rtoIndex !== "other") { draft.compliant = !!CONFIG.RTOS[Number(draft.rtoIndex)].compliant; $("#f-comp").value = draft.compliant ? "1" : "0"; }
      draft.people = {}; draft.people = defaultPeople();
      fillPeople(); fillReminders(); renderItems();
    });
    $("#f-rto-other").addEventListener("input", e => { draft.rtoOther = e.target.value; fillReminders(); });
    $("#f-comp").addEventListener("change", e => { draft.compliant = e.target.value === "1"; draft.people = {}; draft.people = defaultPeople(); fillPeople(); fillReminders(); renderItems(); });
    $("#f-coaching").addEventListener("input", e => draft.coaching = e.target.value);
    $("#f-comp").value = draft.compliant ? "1" : "0";
    $("#f-rto").value = draft.rtoIndex;
    $("#rto-other-wrap").hidden = draft.rtoIndex !== "other";

    // ---- checklist
    function renderItems() {
      const items = scopeItems(draft.stage, draft.compliant);
      const ck = compKey(draft.compliant);
      let html = "", lastPhase = null, n = 0;
      items.forEach(it => {
        if (it.phase !== lastPhase) { const ph = phaseById(it.phase); html += `<h3 class="phase">${esc(ph.title)} <span class="muted">${esc(ph.sop)}</span></h3>`; lastPhase = it.phase; }
        n++;
        const r = draft.results[it.id] || { result: null, note: "" };
        const slot = slotById(ownerOf(it, ck)); const who = draft.people[slot.id] ? memberById(draft.people[slot.id]) : null;
        html += `
          <div class="item ${r.result === "fail" ? "is-fail" : ""}" data-id="${it.id}">
            <div class="item-n">${n}</div>
            <div class="item-body">
              <p>${esc(it.text)}</p>
              <div class="item-meta"><span class="who">${esc(slot.label)}${who ? ": " + esc(who.name) : ""}</span><span class="ref">${esc(it.ref)}</span>${it.critical ? `<span class="crit">Critical</span>` : ""}</div>
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
        const note = row.querySelector(".note");
        const grow = () => { note.style.height = "auto"; note.style.height = note.scrollHeight + "px"; };
        note.addEventListener("input", () => { (draft.results[id] || (draft.results[id] = { result: null, note: "" })).note = note.value; grow(); refreshPanel(); });
        if (note.value) grow();
      });
      refreshPanel();
    }

    const panel = $("#result-panel");
    function refreshPanel() {
      const items = scopeItems(draft.stage, draft.compliant);
      const s = computeSummary(items, draft.results, draft.compliant, draft.people);
      const missingNotes = items.some(it => draft.results[it.id]?.result === "fail" && !(draft.results[it.id].note || "").trim());
      const unassigned = s.byPerson.some(p => !p.memberId);
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
        <button type="submit" class="btn primary block" ${s.unscored || missingNotes || unassigned || !items.length ? "disabled" : ""}>Save audit</button>
        <a class="btn ghost block" href="#/">Cancel</a>
        <p class="muted small">Checks v${esc(CRITERIA.version)}. ${items.length} in scope.</p>`;
    }

    fillStages(); fillPeople(); fillReminders(); fillDays(); renderItems();

    $("#audit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const items = scopeItems(draft.stage, draft.compliant);
      const auditor = draft.auditor.trim();
      localStorage.setItem("atsr_qa_auditor", auditor);
      const ck = compKey(draft.compliant);
      const peopleNames = {}; Object.keys(draft.people).forEach(k => { const m = memberById(draft.people[k]); if (m) peopleNames[k] = m.name; });
      const audit = {
        id: uid("QA"), type: "audit",
        auditType: draft.auditType, stage: draft.stage, stageName: stageByLetter(draft.stage).name,
        fileRef: draft.fileRef.trim(), qualification: draft.qualification.trim(),
        receivedDate: draft.receivedDate, date: draft.date, daysInPipeline: daysBetween(draft.receivedDate, draft.date),
        auditor, rto: rtoName(), rtoShort: rtoShort(), compliant: draft.compliant,
        people: Object.fromEntries(slotsInScope(items, ck).map(s => [s.id, draft.people[s.id] || ""])), peopleNames,
        itemIds: items.map(it => it.id),
        results: Object.fromEntries(items.map(it => [it.id, { result: draft.results[it.id]?.result || null, note: (draft.results[it.id]?.note || "").trim(), owner: ownerOf(it, ck) }])),
        coaching: draft.coaching.trim(),
        summary: computeSummary(items, draft.results, draft.compliant, draft.people),
        criteriaVersion: CRITERIA.version, createdAt: new Date().toISOString(),
      };
      try { await Storage.save(audit); records.push(audit); setStatus("Audit saved.", "ok"); location.hash = "#/audit/" + audit.id; }
      catch (err) { setStatus("Could not save: " + err.message, "err"); }
    });
  }

  // ---- audit view ---------------------------------------------------------
  function renderAudit(id) {
    const a = audits().find(x => x.id === id);
    if (!a) { view().innerHTML = `<p class="empty">Audit not found. <a href="#/">Back</a></p>`; return; }
    const s = a.summary;
    let html = "", lastPhase = null, n = 0;
    a.itemIds.forEach(iid => {
      const it = itemById(iid); if (!it) return;
      if (it.phase !== lastPhase) { const ph = phaseById(it.phase); html += `<h3 class="phase">${esc(ph.title)} <span class="muted">${esc(ph.sop)}</span></h3>`; lastPhase = it.phase; }
      n++;
      const r = a.results[iid] || {}; const slot = slotById(r.owner);
      html += `
        <div class="item ${r.result === "fail" ? "is-fail" : ""}">
          <div class="item-n">${n}</div>
          <div class="item-body">
            <p>${esc(it.text)}</p>
            <div class="item-meta"><span class="who">${esc(slot?.label || "")}${a.peopleNames[r.owner] ? ": " + esc(a.peopleNames[r.owner]) : ""}</span><span class="ref">${esc(it.ref)}</span>${it.critical ? `<span class="crit">Critical</span>` : ""}</div>
            ${r.note ? `<p class="note-ro">${esc(r.note)}</p>` : ""}
          </div>
          <div class="seg"><span class="pill ${esc(r.result || "none")}">${r.result === "pass" ? "Pass" : r.result === "fail" ? "Fail" : r.result === "na" ? "N/A" : "-"}</span></div>
        </div>`;
    });
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / ${esc(a.id)}</nav>
      <section class="hero">
        <div><h1>${esc(a.fileRef || "Audit")}</h1>
          <p class="muted">${esc(auditLabel(a))}. ${esc(a.rto || "RTO not recorded")}, ${esc(compLabel(a.compliant).toLowerCase())}${a.qualification ? ", " + esc(a.qualification) : ""}. Received ${fmtDate(a.receivedDate)}, audited ${fmtDate(a.date)}${a.daysInPipeline !== null ? " (" + a.daysInPipeline + " days)" : ""} by ${esc(a.auditor || "-")}.</p></div>
        <div class="hero-actions"><button class="btn primary" id="btn-pdf">Download PDF</button><button class="btn danger" id="btn-del">Delete</button></div>
      </section>
      <div class="audit">
        <div class="audit-main">
          <div id="items" class="readonly">${html}</div>
          <h3>Coaching note / agreed action</h3>
          <p class="coaching-ro">${a.coaching ? esc(a.coaching) : "<span class='muted'>None recorded.</span>"}</p>
        </div>
        <aside class="result-panel">
          <div class="score ${outcomeClass(s)}"><div class="big">${pct(s.score)}</div><div class="word">${esc(s.outcome)}</div>${s.criticalFail ? `<div class="why">Critical check failed</div>` : ""}</div>
          <dl class="tally"><div><dt>Pass</dt><dd>${s.passed}</dd></div><div><dt>Fail</dt><dd>${s.failed}</dd></div><div><dt>N/A</dt><dd>${s.na}</dd></div></dl>
          <div class="people-scores">${s.byPerson.map(p => `<div class="ps"><div>${p.memberId ? `<a href="#/member/${esc(p.memberId)}"><strong>${esc(p.name)}</strong></a>` : `<strong>${esc(p.name)}</strong>`}<span class="muted small">${esc(p.slots.join(", "))}</span></div><div class="ps-r ${outcomeClass(p)}">${pct(p.score)}</div></div>`).join("")}</div>
          <p class="muted small">Checks v${esc(a.criteriaVersion)}.</p>
        </aside>
      </div>`;
    $("#btn-pdf").addEventListener("click", () => downloadPdf(a.id));
    $("#btn-del").addEventListener("click", async () => {
      if (!confirm("Delete this audit? This cannot be undone.")) return;
      try { await Storage.remove(a.id); records = records.filter(r => r.id !== a.id); setStatus("Audit deleted.", "ok"); location.hash = "#/"; }
      catch (err) { setStatus("Could not delete: " + err.message, "err"); }
    });
  }

  // ---- team ---------------------------------------------------------------
  function renderTeam() {
    const list = records.filter(r => r.type === "member").sort((a, b) => a.name.localeCompare(b.name));
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / Manage team</nav>
      <section class="hero"><div><h1>Manage team</h1><p class="muted">The role prefills who handled each part of a file; the auditor can always change it on the audit. Archive instead of delete so history stays.</p></div></section>
      <form id="member-form" class="inline-form" autocomplete="off">
        <input id="m-name" type="text" placeholder="Full name" required>
        <select id="m-role">${CONFIG.roles.map(r => `<option>${esc(r)}</option>`).join("")}</select>
        <button class="btn primary" type="submit">Add member</button>
      </form>
      <div class="table-wrap"><table class="list">
        <thead><tr><th>Name</th><th>Role</th><th>Audits</th><th></th></tr></thead>
        <tbody>${list.map(m => `<tr class="${m.archived ? "dim" : ""}">
          <td>${esc(m.name)}${m.archived ? " <span class='muted small'>(archived)</span>" : ""}</td>
          <td><select data-role="${esc(m.id)}">${CONFIG.roles.map(r => `<option ${r === m.role ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></td>
          <td>${auditsFor(m.id).length}</td>
          <td class="row-actions"><button class="link" data-rename="${esc(m.id)}">Rename</button> <button class="link" data-arch="${esc(m.id)}">${m.archived ? "Restore" : "Archive"}</button></td>
        </tr>`).join("")}</tbody>
      </table></div>`;
    $("#member-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const rec = { id: uid("M"), type: "member", name: $("#m-name").value.trim(), role: $("#m-role").value, archived: false, createdAt: new Date().toISOString() };
      try { await Storage.save(rec); records.push(rec); setStatus("Added " + rec.name + ".", "ok"); renderTeam(); }
      catch (err) { setStatus("Could not save: " + err.message, "err"); }
    });
    const update = async (m, changes, msg) => { Object.assign(m, changes); try { await Storage.save(m); setStatus(msg, "ok"); renderTeam(); } catch (err) { setStatus("Could not save: " + err.message, "err"); } };
    view().querySelectorAll("[data-role]").forEach(sel => sel.addEventListener("change", () => update(memberById(sel.dataset.role), { role: sel.value }, "Role updated.")));
    view().querySelectorAll("[data-rename]").forEach(b => b.addEventListener("click", () => { const m = memberById(b.dataset.rename); const name = prompt("New name", m.name); if (name && name.trim()) update(m, { name: name.trim() }, "Renamed."); }));
    view().querySelectorAll("[data-arch]").forEach(b => b.addEventListener("click", () => { const m = memberById(b.dataset.arch); update(m, { archived: !m.archived }, m.archived ? "Restored." : "Archived."); }));
  }

  // ---- criteria view ------------------------------------------------------
  function renderCriteria() {
    const tag = (it) => [it.for === "all" ? "" : compLabel(it.for === "compliant") + " only", "from " + (CRITERIA.stages.find(s => s.rank === it.from)?.name || it.from), it.only ? "only at " + it.only.map(l => stageByLetter(l).name).join(", ") : ""].filter(Boolean).join(", ");
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / Checks</nav>
      <section class="hero"><div><h1>Checks v${esc(CRITERIA.version)}</h1><p class="muted">Read-only view of js/criteria.js. ${CRITERIA.items.length} checks, ${CRITERIA.items.filter(i => i.critical).length} critical. Based on the ${esc(CRITERIA.manual)}.</p></div></section>
      ${CRITERIA.phases.map(ph => { const its = CRITERIA.items.filter(i => i.phase === ph.id); return its.length ? `
        <details class="card-def" open>
          <summary><strong>${esc(ph.title)}</strong> <span class="muted">${esc(ph.sop)}, ${its.length} checks</span></summary>
          <ol class="def-list">${its.map(it => `<li>${esc(it.text)} <span class="ref">${esc(it.id)}, ${esc(it.ref)}. Owner: ${esc(typeof it.owner === "string" ? slotById(it.owner).label : "Admin Lead (non-compliant) / Review (compliant)")}. ${esc(tag(it))}</span>${it.critical ? `<span class="crit">Critical</span>` : ""}</li>`).join("")}</ol>
        </details>` : ""; }).join("")}`;
  }

  // ---- backup -------------------------------------------------------------
  function renderData() {
    view().innerHTML = `
      <nav class="crumbs"><a href="#/">Team</a> / Backup</nav>
      <section class="hero"><div><h1>Backup</h1><p class="muted">Local mode keeps records in this browser only. Export a JSON backup regularly, or set a shared endpoint in config.js.</p></div></section>
      <div class="hero-actions"><button class="btn primary" id="btn-export">Export JSON</button><label class="btn ghost">Import JSON <input type="file" id="btn-import" accept="application/json" hidden></label></div>
      <p class="muted small">${records.length} records (${records.filter(r => r.type === "member").length} members, ${records.filter(r => r.type === "audit").length} audits).</p>`;
    $("#btn-export").addEventListener("click", () => { const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "atsr-qa-backup-" + today() + ".json"; a.click(); });
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

  // ---- router -------------------------------------------------------------
  function route() {
    const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
    window.scrollTo(0, 0);
    if (page === "member" && arg) return renderMember(arg);
    if (page === "new") return renderNew();
    if (page === "audit" && arg) return renderAudit(arg);
    if (page === "team") return renderTeam();
    if (page === "criteria") return renderCriteria();
    if (page === "data") return renderData();
    return renderHome();
  }

  async function init() {
    try {
      records = await Storage.listAll();
      // audits saved by the earlier role-based version are not compatible; leave them out
      records = records.filter(r => r.type !== "audit" || r.itemIds);
      if (!records.some(r => r.type === "member") && CONFIG.TEAM_SEED.length) {
        for (const t of CONFIG.TEAM_SEED) { const rec = { id: uid("M"), type: "member", name: t.name, role: t.role, archived: false, createdAt: new Date().toISOString() }; await Storage.save(rec); records.push(rec); }
      }
    } catch (err) { view().innerHTML = `<p class="empty">Could not load records: ${esc(err.message)}. Check WEBHOOK_URL in config.js.</p>`; return; }
    window.addEventListener("hashchange", route);
    route();
  }
  init();
})();
