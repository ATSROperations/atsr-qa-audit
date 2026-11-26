/*
  Searchable dropdowns ("type to search").

  Turns a normal <select> into a text box with a list that narrows as you type. The <select> stays in
  the page (hidden) and keeps the real value, so the rest of the app reads and listens to it as before:
  picking an item sets select.value and fires "change" on the select.

  Which dropdowns get it: any <select> with the attribute data-search, plus any with 8 or more options.
  Add data-plain to a select to keep it as a plain dropdown. New dropdowns are picked up automatically
  when a screen is drawn.

  Matching: every word typed must appear in the option (or its group, e.g. "Compliant"), in any order.
  Options that start with what was typed come first. Keys: Up/Down to move, Enter to pick, Esc to close.
*/
(function () {
  const MIN_OPTIONS = 8;
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  let openCombo = null;

  const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const escHtml = (t) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // An empty-value first option is a prompt ("Select the RTO", "+ person"), unless it is a real choice like "Unassigned".
  const isPrompt = (o) => o.value === "" && !/^(unassigned|none|nothing|\()/i.test(o.text.trim());

  function highlight(text, words) {
    let html = escHtml(text);
    words.filter(Boolean).sort((a, b) => b.length - a.length).forEach(w => {
      const re = new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      html = html.replace(/(<[^>]*>)|([^<]+)/g, (m, tag, txt) => tag ? tag : txt.replace(re, "<mark>$1</mark>"));
    });
    return html;
  }

  function enhance(sel) {
    if (sel._combo || sel.multiple || sel.hasAttribute("data-plain")) return;
    if (!sel.hasAttribute("data-search") && sel.options.length < MIN_OPTIONS) return;

    const wrap = document.createElement("span");
    wrap.className = "combo" + [...sel.classList].map(c => " combo-" + c).join("");
    const input = document.createElement("input");
    input.type = "text"; input.className = "combo-input"; input.autocomplete = "off"; input.spellcheck = false;
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false");
    if (sel.title) input.title = sel.title;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(input); wrap.appendChild(sel);
    sel.classList.add("combo-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");

    const list = document.createElement("ul");
    list.className = "combo-list"; list.setAttribute("role", "listbox");
    let shown = [], active = -1;

    function sync() {
      const o = sel.options[sel.selectedIndex];
      const prompt = sel.options[0] && sel.options[0].value === "" ? sel.options[0].text.trim() : "";
      if (!o || (o.value === "" && isPrompt(o))) { input.value = ""; input.placeholder = prompt || "Type to search"; }
      else { input.value = o.text.trim(); input.placeholder = prompt || "Type to search"; }
      input.disabled = sel.disabled;
      if (wrap.classList.contains("combo-inline")) sizeInline();
    }
    function sizeInline() {
      const len = (input.value || input.placeholder).length;
      input.style.width = Math.min(Math.max(len, 6) + 5, 40) + "ch";
    }
    if (/\b(who-add|part-sel)\b/.test(sel.className)) wrap.classList.add("combo-inline");

    function options() {
      const out = [];
      [...sel.options].forEach((o, i) => {
        if (o.disabled || (i === 0 && isPrompt(o))) return;
        out.push({ o, text: o.text.trim(), group: o.parentElement && o.parentElement.tagName === "OPTGROUP" ? o.parentElement.label : "" });
      });
      return out;
    }
    function render(query) {
      const words = norm(query).split(/\s+/).filter(Boolean);
      let rows = options();
      if (words.length) {
        rows = rows.filter(r => { const hay = norm(r.text + " " + r.group); return words.every(w => hay.includes(w)); });
        const q = norm(query.trim());
        const rank = (r) => { const t = norm(r.text); return t.startsWith(q) ? 0 : t.split(/[\s\-_/()]+/).some(x => x.startsWith(words[0])) ? 1 : 2; };
        rows.sort((a, b) => rank(a) - rank(b));
      }
      shown = rows;
      let html = "", lastGroup = null;
      rows.forEach((r, i) => {
        if (!words.length && r.group && r.group !== lastGroup) { html += `<li class="combo-group" role="presentation">${escHtml(r.group)}</li>`; lastGroup = r.group; }
        html += `<li role="option" data-i="${i}" class="combo-opt${r.o.selected && r.o.value !== "" ? " is-selected" : ""}"><span class="combo-txt">${highlight(r.text, words)}</span>${r.o.dataset.hint ? `<span class="combo-tag">${escHtml(r.o.dataset.hint)}</span>` : words.length && r.group ? `<span class="combo-tag">${escHtml(r.group)}</span>` : ""}</li>`;
      });
      list.innerHTML = html || `<li class="combo-empty">No match</li>`;
      const sIdx = rows.findIndex(r => r.o.selected);
      setActive(words.length ? (rows.length ? 0 : -1) : (sIdx >= 0 ? sIdx : 0), !words.length);
    }
    function setActive(i, center) {
      active = i;
      list.querySelectorAll(".combo-opt").forEach(li => li.classList.toggle("is-active", Number(li.dataset.i) === i));
      const li = list.querySelector(`.combo-opt[data-i="${i}"]`);
      if (li) { if (center) li.scrollIntoView({ block: "center" }); else li.scrollIntoView({ block: "nearest" }); }
    }
    function place() {
      if (!input.isConnected) { close(false); return; }
      const r = input.getBoundingClientRect();
      const below = window.innerHeight - r.bottom, maxH = 300;
      list.style.minWidth = Math.max(r.width, wrap.classList.contains("combo-inline") ? 240 : 0) + "px";
      list.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, 240) - 8) + "px";
      if (below < 220 && r.top > below) { list.style.top = ""; list.style.bottom = (window.innerHeight - r.top + 4) + "px"; list.style.maxHeight = Math.min(maxH, r.top - 12) + "px"; }
      else { list.style.bottom = ""; list.style.top = (r.bottom + 4) + "px"; list.style.maxHeight = Math.min(maxH, below - 12) + "px"; }
    }
    function open() {
      if (openCombo && openCombo !== api) openCombo.close(true);
      if (!list.isConnected) document.body.appendChild(list);
      openCombo = api; input.setAttribute("aria-expanded", "true"); wrap.classList.add("is-open");
      render(""); place(); input.select();
    }
    function close(restore) {
      if (list.isConnected) list.remove();
      if (openCombo === api) openCombo = null;
      input.setAttribute("aria-expanded", "false"); wrap.classList.remove("is-open");
      if (restore !== false) sync();
    }
    function pick(i) {
      const r = shown[i]; if (!r) return;
      close(false);
      if (sel.value !== r.o.value || r.o.value === "") {
        nativeValue.set.call(sel, r.o.value);
        sync();
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      } else sync();
      if (sel.classList.contains("who-add")) { nativeValue.set.call(sel, ""); }
    }

    input.addEventListener("focus", () => { if (!wrap.classList.contains("is-open")) open(); });
    input.addEventListener("mousedown", () => { if (document.activeElement === input && !wrap.classList.contains("is-open")) open(); });
    input.addEventListener("input", () => { if (!wrap.classList.contains("is-open")) open(); render(input.value); place(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!wrap.classList.contains("is-open")) open(); else setActive(Math.min(active + 1, shown.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
      else if (e.key === "Enter") { if (wrap.classList.contains("is-open")) { e.preventDefault(); if (active >= 0) pick(active); } }
      else if (e.key === "Escape") { if (wrap.classList.contains("is-open")) { e.preventDefault(); close(); } }
      else if (e.key === "Tab") { close(); }
    });
    input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) close(); }, 120));
    list.addEventListener("mousedown", (e) => { e.preventDefault(); const li = e.target.closest(".combo-opt"); if (li) pick(Number(li.dataset.i)); });

    // Keep the box in step when the app sets the value in code, or Playwright/the browser changes it.
    Object.defineProperty(sel, "value", { configurable: true, get() { return nativeValue.get.call(this); }, set(v) { nativeValue.set.call(this, v); sync(); } });
    sel.addEventListener("change", sync);
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });

    const api = { close, place };
    sel._combo = api;
    sync();
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === "SELECT") enhance(root);
    root.querySelectorAll("select").forEach(enhance);
  }
  function reposition(e) { if (openCombo && !(e && e.target && e.target.classList && e.target.classList.contains("combo-list"))) openCombo.place(); }

  document.addEventListener("DOMContentLoaded", () => {
    scan(document.body);
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); }))).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    // a screen redraw removes the box: drop its list too
    window.addEventListener("hashchange", () => { if (openCombo) openCombo.close(); });
  });
})();
