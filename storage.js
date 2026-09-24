/*
  Storage adapter. Everything is a "record" with an id and a type ("member" or "audit").

  Two modes, same four methods:
    local   - localStorage in this browser (CONFIG.WEBHOOK_URL empty)
    webhook - CONFIG.WEBHOOK_URL, contract in README.md
*/

const Storage = (() => {
  const KEY = "atsr_qa_records_v1";
  const mode = CONFIG.WEBHOOK_URL ? "webhook" : "local";

  // ---- local ------------------------------------------------------------
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
    catch (e) { return []; }
  }
  function writeLocal(records) {
    try { localStorage.setItem(KEY, JSON.stringify(records)); }
    catch (e) { console.error("localStorage write failed", e); }
  }

  const local = {
    async listAll() { return readLocal(); },
    async save(record) {
      const records = readLocal().filter(r => r.id !== record.id);
      records.push(record);
      writeLocal(records);
      return record;
    },
    async remove(id) {
      writeLocal(readLocal().filter(r => r.id !== id));
      return true;
    },
    async replaceAll(records) { writeLocal(records); return true; },
  };

  // ---- webhook ----------------------------------------------------------
  function headers() {
    const h = { "Content-Type": "application/json" };
    if (CONFIG.WEBHOOK_KEY) h["x-qa-key"] = CONFIG.WEBHOOK_KEY;
    return h;
  }
  async function post(body) {
    const res = await fetch(CONFIG.WEBHOOK_URL, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error("Storage error " + res.status);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  const webhook = {
    async listAll() {
      const res = await fetch(CONFIG.WEBHOOK_URL + "?action=list", { headers: headers() });
      if (!res.ok) throw new Error("Storage error " + res.status);
      const data = await res.json();
      return Array.isArray(data) ? data : (data.records || []);
    },
    async save(record) { await post({ action: "save", record }); return record; },
    async remove(id) { await post({ action: "delete", id }); return true; },
    async replaceAll() { throw new Error("Import is only available in local mode."); },
  };

  const impl = mode === "webhook" ? webhook : local;
  return { mode, ...impl };
})();
