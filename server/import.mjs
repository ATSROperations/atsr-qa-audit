/*
  Load a full export (Backup > Full export, on the old site) into this server's database.

    node server/import.mjs atsr-qa-full-export-YYYY-MM-DD.json            logins, records and roles
    node server/import.mjs export.json --skip-users                          records and roles only
    node server/import.mjs export.json --force                               allow an import into a database that already has data

  Logins only keep working if AUTH_PEPPER here is the same value as on the old site. If that value
  is lost, use --skip-users: the owner then signs in with OWNER_INITIAL_PASSWORD and recreates the
  2-3 auditor logins.
  Stop the app first (or run it before the first start), then start it again.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, ensureTables, backup } from "./db.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
const skipUsers = args.includes("--skip-users"), force = args.includes("--force");
if (!file) { console.error("Usage: node server/import.mjs <full-export.json> [--skip-users] [--force]"); process.exit(1); }
if (fs.existsSync(path.join(ROOT, ".env"))) for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) { const m = line.match(/^\s*(DATA_DIR)\s*=\s*(.*)\s*$/); if (m && !process.env.DATA_DIR) process.env.DATA_DIR = m[2].replace(/^(['"])(.*)\1$/, "$2"); }
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));

const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.app !== "atsr-qa-audit" || !Array.isArray(data.records)) { console.error("This is not a full export from the QA app (use Backup > Full export)."); process.exit(1); }

const { sqlite } = openDatabase(path.join(DATA_DIR, "qa.db"));
ensureTables(sqlite);
const count = (t) => sqlite.prepare("SELECT COUNT(*) AS n FROM " + t).get().n;
if (!force && (count("users") || count("records"))) { console.error("The database in " + DATA_DIR + " already has data. Add --force to merge into it (rows with the same id are replaced)."); process.exit(1); }
if (count("users") || count("records")) console.log("Safety copy before import: " + backup(sqlite, path.join(DATA_DIR, "backups")));

const insert = (table, rows, cols) => {
  const st = sqlite.prepare("INSERT OR REPLACE INTO " + table + " (" + cols.join(", ") + ") VALUES (" + cols.map((_, i) => "?" + (i + 1)).join(", ") + ")");
  rows.forEach(r => st.run(...cols.map(c => r[c] === undefined ? null : r[c])));
  return rows.length;
};
sqlite.exec("BEGIN");
try {
  const u = skipUsers ? 0 : insert("users", data.users || [], ["id", "email", "name", "level", "pass", "must_change", "failed", "locked_until", "disabled", "created_at", "created_by", "last_login"]);
  if (!skipUsers) sqlite.exec("UPDATE users SET failed = 0, locked_until = NULL");
  const r = insert("records", data.records, ["id", "type", "json", "created_by", "created_at", "updated_by", "updated_at", "deleted_by", "deleted_at"]);
  const s = insert("settings", data.settings || [], ["key", "value", "updated_by", "updated_at"]);
  sqlite.exec("COMMIT");
  console.log("Imported " + u + " logins, " + r + " records (" + data.records.filter(x => !x.deleted_at).length + " active) and " + s + " settings into " + DATA_DIR + ".");
  console.log(skipUsers ? "Logins were skipped. Sign in with the owner email and OWNER_INITIAL_PASSWORD, then recreate the auditor logins." : "Everyone signs in again with their existing password (needs the same AUTH_PEPPER as the old site).");
} catch (e) { sqlite.exec("ROLLBACK"); console.error("Import failed, nothing changed:", e.message); process.exit(1); }
