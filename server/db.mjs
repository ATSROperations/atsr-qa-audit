/*
  SQLite database for the Node server, shaped like Cloudflare D1 so the API file
  (functions/api/[[path]].js) runs unchanged: db.prepare(sql).bind(...).first() / .all() / .run(),
  and db.batch([...]). Uses Node's built-in node:sqlite (Node 22.13 or newer), so there is nothing
  to install or compile.
*/
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const clean = (args) => args.map(v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...a) => statement(sql, clean(a)),
    first: async (col) => { const row = sqlite.prepare(sql).get(...args) ?? null; return row && col ? row[col] : row; },
    all: async () => ({ results: sqlite.prepare(sql).all(...args), success: true }),
    run: async () => { const r = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  const db = {
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      sqlite.exec("BEGIN");
      try { const out = list.map(s => { sqlite.prepare(s.sql).run(...s.args); return { success: true }; }); sqlite.exec("COMMIT"); return out; }
      catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
  };
  return { db, sqlite };
}

// Same tables the API creates on first use (kept here so the import script can run before the first request).
export function ensureTables(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, level TEXT NOT NULL,
      pass TEXT NOT NULL, must_change INTEGER DEFAULT 1, failed INTEGER DEFAULT 0, locked_until TEXT,
      disabled INTEGER DEFAULT 0, created_at TEXT, created_by TEXT, last_login TEXT);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT);
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, json TEXT NOT NULL,
      created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT, deleted_by TEXT, deleted_at TEXT);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT);`);
}

// Consistent copy of the live database into backups/, keeping the newest `keep` files.
export function backup(sqlite, dir, keep = 30) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const file = path.join(dir, "qa-" + stamp + ".db");
  if (fs.existsSync(file)) return file;
  sqlite.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
  const old = fs.readdirSync(dir).filter(f => /^qa-.*\.db$/.test(f)).sort().reverse().slice(keep);
  old.forEach(f => fs.unlinkSync(path.join(dir, f)));
  return file;
}
