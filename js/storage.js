/*
  Storage adapter. Everything is a "record" with an id and a type ("member" or "audit").

  Two modes:
    cloudflare - the live site (hosts in CONFIG.SHARED_HOSTS). Sign-in required. Records, roles,
                 logins and the RTO list come from /api (functions/api/[[path]].js), which
                 enforces who may do what.
    local      - anywhere else (a local copy, the preview). No sign-in, this browser only.

  Storage.me is the signed-in user {email, name, level}. The app hides buttons by level; the
  server enforces the same rules regardless.
*/

const Storage = (() => {
  const KEY = "atsr_qa_records_v1";
  const host = location.hostname;
  const mode = (CONFIG.SHARED_HOSTS || []).some(h => host === h || host.endsWith("." + h)) ? "cloudflare" : "local";
  const DEFAULT_ROLES = [
    { name: "Intake Admin", slot: "intake" }, { name: "Drafting Admin", slot: "drafting" },
    { name: "Compliant Colleges Admin", slot: "compliant" }, { name: "Admin Lead", slot: "lead" }, { name: "BD Manager", slot: "posting" },
  ];
  let me = { email: null, name: "Local user", level: "owner" };
  let roles = DEFAULT_ROLES;

  // ---- local ------------------------------------------------------------
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } };
  const writeLocal = (records) => { try { localStorage.setItem(KEY, JSON.stringify(records)); } catch (e) { console.error("localStorage write failed", e); } };
  const readRoles = () => { try { return JSON.parse(localStorage.getItem(KEY + "_roles")) || DEFAULT_ROLES; } catch (e) { return DEFAULT_ROLES; } };
  const local = {
    async init() {
      roles = readRoles();
      return { state: "ready", me, roles, records: readLocal(),
        master: typeof MASTER !== "undefined" ? MASTER : { rtos: [], qualifications: [] },
        collegeNotes: typeof COLLEGE_NOTES !== "undefined" ? COLLEGE_NOTES : {} };
    },
    async save(record) { const r = readLocal().filter(x => x.id !== record.id); r.push(record); writeLocal(r); return record; },
    async remove(id) { writeLocal(readLocal().filter(r => r.id !== id)); return true; },
    async replaceAll(records) { writeLocal(records); return true; },
    async setRoles(next) { roles = next; localStorage.setItem(KEY + "_roles", JSON.stringify(next)); return next; },
    async login() { throw new Error("No sign-in in local mode."); },
    async logout() { return true; },
    async changePassword() { throw new Error("No passwords in local mode."); },
    async listUsers() { return []; }, async createUser() { throw new Error("Logins only exist on the live site."); },
    async updateUser() { throw new Error("Logins only exist on the live site."); }, async resetUser() { throw new Error("Logins only exist on the live site."); },
  };

  // ---- cloudflare -------------------------------------------------------
  class ApiError extends Error { constructor(status, message, data) { super(message); this.status = status; this.data = data; } }
  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch("/api/" + path, { ...options, credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) } });
    } catch (e) { throw new ApiError(0, "Cannot reach the server. Check your connection."); }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || ("Server error " + res.status), data);
    return data;
  }
  const cloud = {
    async init() {
      try {
        const b = await api("bootstrap");
        me = b.me; roles = b.roles;
        return { state: "ready", ...b };
      } catch (e) {
        if (e.status === 401) return { state: "login" };
        if (e.status === 428) { me = e.data.me; return { state: "mustChange", me }; }
        throw e;
      }
    },
    async login(email, password) { const r = await api("login", { method: "POST", body: JSON.stringify({ email, password }) }); me = r.me; return r.me; },
    async logout() { try { await api("logout", { method: "POST" }); } catch (e) {} return true; },
    async changePassword(current, next) { return api("password", { method: "POST", body: JSON.stringify({ current, next }) }); },
    async save(record) { return api("records", { method: "POST", body: JSON.stringify({ record }) }); },
    async remove(id) { await api("records/" + encodeURIComponent(id), { method: "DELETE" }); return true; },
    async replaceAll() { throw new Error("Import is only available in a local copy."); },
    async setRoles(next) { roles = await api("roles", { method: "PUT", body: JSON.stringify({ roles: next }) }); return roles; },
    async listUsers() { return api("users"); },
    async createUser(u) { return api("users", { method: "POST", body: JSON.stringify(u) }); },
    async updateUser(id, changes) { return api("users/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(changes) }); },
    async resetUser(id) { return api("users/" + encodeURIComponent(id) + "/reset", { method: "POST" }); },
  };

  const impl = mode === "cloudflare" ? cloud : local;
  return { mode, get me() { return me; }, get roles() { return roles; }, ...impl };
})();
