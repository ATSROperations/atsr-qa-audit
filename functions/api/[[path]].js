/*
  ATSR B2B QA Audit - server API (Cloudflare Pages Function). Every /api/* request comes here.
  The browser cannot bypass these rules.

  Sign-in: the app's own email + password login. Passwords are hashed (PBKDF2, per-user salt,
  plus a secret pepper held only in Cloudflare). Sessions are HttpOnly cookies. Five failed
  attempts lock an account for 15 minutes.

  Access levels
    owner    the one account in OWNER_EMAIL. Everything, including creating logins, resetting
             passwords, changing access levels, disabling accounts.
    admin    delete audits, add/rename/archive/delete team members, manage job roles.
    auditor  view everything, add audits, change their own password.

  Data rules
    - Audits cannot be changed once saved. Deletes are soft (row kept with who and when).
    - A team member with audits can be archived, not deleted.
    - Every audit is stamped with the signed-in user's email and name.

  Setup (Pages project > Settings)
    Bindings:  D1 database, variable name DB                              (required)
    Variables: OWNER_EMAIL             default operations@atsrpl.com.au
               OWNER_INITIAL_PASSWORD  used once, to create the owner account on first sign-in (required)
               AUTH_PEPPER             long random secret; set once and never change          (recommended)
               AUTH_ITERATIONS         PBKDF2 rounds, default 50000 (free plan CPU budget)
*/

import { MASTER } from "./master-data.js";
import { COLLEGE_NOTES } from "./college-notes.js";

const DEFAULT_OWNER = "operations@atsrpl.com.au";
const DEFAULT_ITERATIONS = 50000;
const SESSION_DAYS = 7;
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 10;
const MAX_RECORD_BYTES = 300000;
const COOKIE = "qa_session";
const LEVELS = ["owner", "admin", "auditor"];
const DEFAULT_ROLES = [
  { name: "Intake Admin", slot: "intake" },
  { name: "Drafting Admin", slot: "drafting" },
  { name: "Compliant Colleges Admin", slot: "compliant" },
  { name: "Admin Lead", slot: "lead" },
  { name: "BD Manager", slot: "posting" },
];
const SLOT_KEYS = ["intake", "drafting", "review", "compliant", "lead", "posting", "cancel", "none"];

// ---------------------------------------------------------------- helpers
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
});
const fail = (status, message) => json({ error: message }, status);
const now = () => new Date().toISOString();
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const norm = (s) => String(s || "").trim().toLowerCase();
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const uid = (p) => p + "-" + hex(randomBytes(8));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
function getCookie(request, name) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
function tempPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return [...bytes].map(b => alphabet[b % alphabet.length]).join("");
}
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

// ---------------------------------------------------------------- passwords
async function pepper(password, env) {
  if (!env.AUTH_PEPPER) return enc.encode(password);
  const key = await crypto.subtle.importKey("raw", enc.encode(env.AUTH_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(password)));
}
async function derive(password, salt, iterations, env) {
  const key = await crypto.subtle.importKey("raw", await pepper(password, env), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
async function hashPassword(password, env) {
  const iterations = Math.max(10000, Number(env.AUTH_ITERATIONS) || DEFAULT_ITERATIONS);
  const salt = randomBytes(16);
  const bits = await derive(password, salt, iterations, env);
  return "pbkdf2$" + iterations + "$" + b64(salt) + "$" + b64(bits);
}
async function verifyPassword(password, stored, env) {
  const [algo, iters, salt, hash] = String(stored || "").split("$");
  if (algo !== "pbkdf2") return false;
  const bits = await derive(password, unb64(salt), Number(iters), env);
  return equalBytes(bits, unb64(hash));
}
function passwordProblem(pw) {
  if (typeof pw !== "string") return "Password missing.";
  if (pw.length < MIN_PASSWORD) return "Password must be at least " + MIN_PASSWORD + " characters.";
  if (pw.length > 128) return "Password is too long.";
  return null;
}

// ---------------------------------------------------------------- database
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, level TEXT NOT NULL,
      pass TEXT NOT NULL, must_change INTEGER DEFAULT 1, failed INTEGER DEFAULT 0, locked_until TEXT,
      disabled INTEGER DEFAULT 0, created_at TEXT, created_by TEXT, last_login TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, json TEXT NOT NULL,
      created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT, deleted_by TEXT, deleted_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT)`),
  ]);
  schemaReady = true;
}
async function getSetting(db, key, fallback) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first();
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch (e) { return fallback; }
}
async function setSetting(db, key, value, by) {
  await db.prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = ?4")
    .bind(key, JSON.stringify(value), by, now()).run();
}
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, level: u.level, mustChange: !!u.must_change, disabled: !!u.disabled, lastLogin: u.last_login || null, createdAt: u.created_at || null });

// ---------------------------------------------------------------- sessions
async function sessionUser(request, db) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const row = await db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?1 AND s.expires_at > ?2")
    .bind(await sha256(token), now()).first();
  if (!row || row.disabled) return null;
  return row;
}
function cookieHeader(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + secure;
}
async function startSession(request, db, userId) {
  const token = hex(randomBytes(32));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)").bind(await sha256(token), userId, expires, now()).run();
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now()).run();
  return { "set-cookie": cookieHeader(request, token, SESSION_DAYS * 86400) };
}

// ---------------------------------------------------------------- handler
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = request.method.toUpperCase();
  if (!env.DB) return fail(500, "Storage is not set up. Bind a D1 database to this Pages project with the variable name DB.");
  const db = env.DB;
  await ensureSchema(db);
  const OWNER = norm(env.OWNER_EMAIL || DEFAULT_OWNER);
  const readBody = async () => { const t = await request.text(); if (t.length > MAX_RECORD_BYTES) throw new Error("too large"); return t ? JSON.parse(t) : {}; };

  // ---- sign in (no session needed)
  if (path === "login" && method === "POST") {
    let body; try { body = await readBody(); } catch (e) { return fail(400, "Invalid request."); }
    const email = norm(body.email), password = String(body.password || "");
    if (!email || !password) return fail(400, "Email and password are required.");
    let user = await db.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first();

    // first ever sign-in creates the owner account from OWNER_INITIAL_PASSWORD.
    // While no account exists yet, errors say exactly what is missing; that reveals nothing
    // about any account because there are none.
    if (!user) {
      const count = (await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n;
      if (count === 0) {
        const initial = String(env.OWNER_INITIAL_PASSWORD || "").trim();
        if (email !== OWNER) return fail(401, "No accounts exist yet. The first sign-in must use the owner email (" + OWNER + ").");
        if (!initial) return fail(500, "First sign-in is not set up: this deployment does not have the OWNER_INITIAL_PASSWORD secret. Add it under Settings > Variables and Secrets (Production), then retry the latest deployment.");
        if (password.trim() !== initial) return fail(401, "OWNER_INITIAL_PASSWORD is set, but the password you typed doesn't match it. Check capitals, or overwrite the secret with a simple value and retry the latest deployment.");
        user = { id: uid("U"), email, name: "Owner", level: "owner" };
        await db.prepare("INSERT INTO users (id, email, name, level, pass, must_change, created_at, created_by) VALUES (?1, ?2, ?3, 'owner', ?4, 1, ?5, 'setup')")
          .bind(user.id, email, user.name, await hashPassword(password, env), now()).run();
        user = await db.prepare("SELECT * FROM users WHERE id = ?1").bind(user.id).first();
      }
    }
    if (!user) return fail(401, "Wrong email or password.");
    if (user.disabled) return fail(403, "This account is disabled.");
    if (user.locked_until && user.locked_until > now()) return fail(423, "Too many failed attempts. Try again in " + LOCK_MINUTES + " minutes.");
    if (!(await verifyPassword(password, user.pass, env))) {
      const failed = (user.failed || 0) + 1;
      if (failed >= LOCK_AFTER) await db.prepare("UPDATE users SET failed = 0, locked_until = ?2 WHERE id = ?1").bind(user.id, new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()).run();
      else await db.prepare("UPDATE users SET failed = ?2 WHERE id = ?1").bind(user.id, failed).run();
      return fail(401, "Wrong email or password.");
    }
    await db.prepare("UPDATE users SET failed = 0, locked_until = NULL, last_login = ?2 WHERE id = ?1").bind(user.id, now()).run();
    const headers = await startSession(request, db, user.id);
    return json({ me: publicUser(user) }, 200, headers);
  }

  // ---- everything else needs a session
  const user = await sessionUser(request, db);
  if (!user) return fail(401, "Not signed in.");
  const level = user.level;
  const isOwner = level === "owner", isAdmin = isOwner || level === "admin";
  const me = publicUser(user);

  if (path === "logout" && method === "POST") {
    const token = getCookie(request, COOKIE);
    if (token) await db.prepare("DELETE FROM sessions WHERE id = ?1").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": cookieHeader(request, "", 0) });
  }

  // own password
  if (path === "password" && method === "POST") {
    let body; try { body = await readBody(); } catch (e) { return fail(400, "Invalid request."); }
    if (!(await verifyPassword(String(body.current || ""), user.pass, env))) return fail(401, "Current password is wrong.");
    const p = passwordProblem(body.next); if (p) return fail(400, p);
    if (body.next === body.current) return fail(400, "Choose a different password.");
    await db.prepare("UPDATE users SET pass = ?2, must_change = 0 WHERE id = ?1").bind(user.id, await hashPassword(body.next, env)).run();
    return json({ ok: true });
  }

  // a user who must change their password can do nothing else
  if (user.must_change) return json({ error: "Set a new password to continue.", mustChange: true, me }, 428);

  if (path === "me" && method === "GET") return json({ me });

  // everything the app needs at start, in one call
  if (path === "bootstrap" && method === "GET") {
    const { results } = await db.prepare("SELECT json FROM records WHERE deleted_at IS NULL ORDER BY created_at").all();
    const roles = await getSetting(db, "roles", DEFAULT_ROLES);
    return json({ me, roles, master: MASTER, collegeNotes: COLLEGE_NOTES, records: results.map(r => JSON.parse(r.json)) });
  }

  // ---- users (owner only)
  if (path === "users" || /^users\/[A-Za-z0-9-]+(\/reset)?$/.test(path)) {
    if (!isOwner) return fail(403, "Only the owner can manage logins.");
    if (path === "users" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM users ORDER BY level, email").all();
      return json(results.map(publicUser));
    }
    if (path === "users" && method === "POST") {
      let body; try { body = await readBody(); } catch (e) { return fail(400, "Invalid request."); }
      const email = norm(body.email), name = String(body.name || "").trim(), lvl = body.level === "admin" ? "admin" : "auditor";
      if (!isEmail(email)) return fail(400, "Enter a valid email address.");
      if (!name) return fail(400, "Enter the person's name.");
      if (await db.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first()) return fail(409, "That email already has a login.");
      const temp = tempPassword(); const id = uid("U");
      await db.prepare("INSERT INTO users (id, email, name, level, pass, must_change, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)")
        .bind(id, email, name, lvl, await hashPassword(temp, env), now(), user.email).run();
      return json({ user: publicUser(await db.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first()), tempPassword: temp });
    }
    const m = path.match(/^users\/([A-Za-z0-9-]+)(\/reset)?$/);
    const target = await db.prepare("SELECT * FROM users WHERE id = ?1").bind(m[1]).first();
    if (!target) return fail(404, "Login not found.");
    if (m[2] && method === "POST") {
      const temp = tempPassword();
      await db.prepare("UPDATE users SET pass = ?2, must_change = 1, failed = 0, locked_until = NULL WHERE id = ?1").bind(target.id, await hashPassword(temp, env)).run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(target.id).run();
      return json({ tempPassword: temp });
    }
    if (!m[2] && method === "PUT") {
      let body; try { body = await readBody(); } catch (e) { return fail(400, "Invalid request."); }
      if (target.level === "owner" && (body.level && body.level !== "owner" || body.disabled)) return fail(400, "The owner account cannot be downgraded or disabled.");
      const lvl = body.level && LEVELS.includes(body.level) && target.level !== "owner" ? (body.level === "owner" ? target.level : body.level) : target.level;
      const name = body.name !== undefined ? String(body.name).trim() || target.name : target.name;
      const disabled = body.disabled !== undefined ? (body.disabled ? 1 : 0) : target.disabled;
      await db.prepare("UPDATE users SET level = ?2, name = ?3, disabled = ?4 WHERE id = ?1").bind(target.id, lvl, name, disabled).run();
      if (disabled) await db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(target.id).run();
      return json(publicUser(await db.prepare("SELECT * FROM users WHERE id = ?1").bind(target.id).first()));
    }
    return fail(405, "Method not allowed.");
  }

  // ---- job roles (read: everyone, write: admin+)
  if (path === "roles") {
    if (method === "GET") return json(await getSetting(db, "roles", DEFAULT_ROLES));
    if (method === "PUT") {
      if (!isAdmin) return fail(403, "Only an admin can change roles.");
      let body; try { body = await readBody(); } catch (e) { return fail(400, "Invalid request."); }
      const roles = (body.roles || []).map(r => ({ name: String(r.name || "").trim(), slot: SLOT_KEYS.includes(r.slot) ? r.slot : "none" })).filter(r => r.name);
      const names = roles.map(r => r.name.toLowerCase());
      if (new Set(names).size !== names.length) return fail(400, "Two roles have the same name.");
      await setSetting(db, "roles", roles, user.email);
      return json(roles);
    }
    return fail(405, "Method not allowed.");
  }

  // ---- records
  if (path === "records" && method === "GET") {
    const { results } = await db.prepare("SELECT json FROM records WHERE deleted_at IS NULL ORDER BY created_at").all();
    return json(results.map(r => JSON.parse(r.json)));
  }
  if (path === "records" && method === "POST") {
    let body; try { body = await readBody(); } catch (e) { return fail(400, "Invalid request."); }
    const rec = body && body.record;
    if (!rec || typeof rec.id !== "string" || !/^[A-Za-z0-9-]{3,80}$/.test(rec.id)) return fail(400, "Record needs a valid id.");
    if (rec.type !== "member" && rec.type !== "audit") return fail(400, "Unknown record type.");
    const existing = await db.prepare("SELECT type FROM records WHERE id = ?1").bind(rec.id).first();
    if (existing && existing.type !== rec.type) return fail(409, "That id belongs to a different kind of record.");
    if (rec.type === "member") {
      if (!isAdmin) return fail(403, "Only an admin can add or change team members.");
      if (!rec.name || !String(rec.name).trim()) return fail(400, "A team member needs a name.");
      rec.roles = Array.isArray(rec.roles) ? rec.roles.map(r => String(r).trim()).filter(Boolean) : [];
    }
    if (rec.type === "audit") {
      if (existing) return fail(409, "Audits cannot be changed once saved. An admin can delete it so it can be redone.");
      rec.loggedBy = user.email; rec.loggedAt = now(); rec.auditor = user.name;
    }
    if (existing) await db.prepare("UPDATE records SET json = ?2, updated_by = ?3, updated_at = ?4, deleted_by = NULL, deleted_at = NULL WHERE id = ?1").bind(rec.id, JSON.stringify(rec), user.email, now()).run();
    else await db.prepare("INSERT INTO records (id, type, json, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(rec.id, rec.type, JSON.stringify(rec), user.email, now()).run();
    return json(rec);
  }
  const rm = path.match(/^records\/([A-Za-z0-9-]{3,80})$/);
  if (rm && method === "DELETE") {
    if (!isAdmin) return fail(403, "Only an admin can delete.");
    const row = await db.prepare("SELECT type FROM records WHERE id = ?1 AND deleted_at IS NULL").bind(rm[1]).first();
    if (!row) return fail(404, "Not found.");
    if (row.type === "member") {
      const used = await db.prepare("SELECT COUNT(*) AS n FROM records WHERE type = 'audit' AND deleted_at IS NULL AND json LIKE ?1").bind('%"memberId":"' + rm[1] + '"%').first();
      if (used && used.n > 0) return fail(409, "This person has audits. Archive them instead so their history stays.");
    }
    await db.prepare("UPDATE records SET deleted_by = ?2, deleted_at = ?3 WHERE id = ?1").bind(rm[1], user.email, now()).run();
    return json({ deleted: rm[1] });
  }

  return fail(404, "Not found.");
}
