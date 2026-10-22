/*
  ATSR B2B QA Audit - Node.js server (ATSR's Hetzner server, behind Nginx; any Linux server with Node 22.13+).

  Serves the app (index.html, css/, js/, assets/) and runs the same API as the Cloudflare version
  (functions/api/[[path]].js) on a SQLite file. No packages to install.

  Start:   node server/server.mjs        (or: npm start)
  Settings (environment variables; see server/README.md):
    PORT                    port to listen on (default 3000)
    HOST                    address to listen on (default 127.0.0.1: only Nginx on the same server can reach it)
    DATA_DIR                folder for the database and backups. MUST be outside the code folder so
                            deploys never touch it. Default ./data (fine for a local test only).
    AUTH_PEPPER             long random secret. Set once, never change. Same value as on Cloudflare if
                            logins are being moved across.
    OWNER_INITIAL_PASSWORD  used once, the first time the owner signs in on an empty database
    OWNER_EMAIL             default operations@atsrpl.com.au
    AUTH_ITERATIONS         PBKDF2 rounds for new passwords (default here 210000)
    BACKUP_KEEP             daily backups to keep (default 30)
*/
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, ensureTables, backup } from "./db.mjs";
import { onRequest } from "../functions/api/[[path]].js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const DB_FILE = path.join(DATA_DIR, "qa.db");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const MAX_BODY = 1024 * 1024;

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) { console.error("Node 22.13 or newer is needed (found " + process.versions.node + "). Pick Node 22 or 24 in the hosting panel."); process.exit(1); }
if (!process.env.DATA_DIR) console.warn("WARNING: DATA_DIR is not set. Using " + DATA_DIR + ". Set DATA_DIR to a folder outside the code folder before real use, or a deploy could remove the database.");
if (!process.env.AUTH_PEPPER) console.warn("WARNING: AUTH_PEPPER is not set. Set it before anyone signs in.");

const { db, sqlite } = openDatabase(DB_FILE);
ensureTables(sqlite);
const env = {
  DB: db,
  OWNER_EMAIL: process.env.OWNER_EMAIL,
  OWNER_INITIAL_PASSWORD: process.env.OWNER_INITIAL_PASSWORD,
  AUTH_PEPPER: process.env.AUTH_PEPPER,
  AUTH_ITERATIONS: process.env.AUTH_ITERATIONS || "210000",   // no 10 ms CPU cap here, so stronger than on Cloudflare
};

// ---- daily backup (on start, then every 24 hours)
const runBackup = () => { try { console.log("Backup written: " + backup(sqlite, BACKUP_DIR, Number(process.env.BACKUP_KEEP) || 30)); } catch (e) { console.error("Backup failed:", e.message); } };
runBackup(); setInterval(runBackup, 24 * 3600 * 1000).unref();

// ---- static files: only the app itself is public
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2", ".json": "application/json" };
const PUBLIC_DIRS = ["css", "js", "assets"];
const SECURITY = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "same-origin" };
let indexHtml = null;
function readIndex() {
  // Mark the page as served by this server so the app runs in signed-in, shared mode on any domain.
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  return html.replace("<head>", '<head>\n  <meta name="qa-server" content="node">');
}
function serveStatic(req, res, urlPath) {
  if (urlPath === "/" || urlPath === "/index.html") {
    if (!indexHtml || process.env.NODE_ENV === "development") indexHtml = readIndex();
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-cache", ...SECURITY });
    return res.end(req.method === "HEAD" ? undefined : indexHtml);
  }
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const top = rel.split(/[/\\]/)[0];
  const file = path.join(ROOT, rel);
  if (!PUBLIC_DIRS.includes(top) || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain", ...SECURITY }); return res.end("Not found");
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": top === "assets" ? "public, max-age=86400" : "no-cache", ...SECURITY });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---- API: hand the request to the shared API file
async function serveApi(req, res) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413, { "content-type": "application/json" }); return res.end('{"error":"Request too large."}'); } chunks.push(c); }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = String(req.headers["x-forwarded-proto"] || (local ? "http" : "https")).split(",")[0].trim();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
  const out = await onRequest({ request: new Request(proto + "://" + host + req.url, { method: req.method, headers, body }), env });
  const h = { ...SECURITY }; out.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(out.status, h); res.end(Buffer.from(await out.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/healthz") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("ok"); }
    if (urlPath === "/api" || urlPath.startsWith("/api/")) return await serveApi(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, urlPath);
  } catch (e) {
    console.error(new Date().toISOString(), req.method, req.url, e);
    if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"Server error."}'); }
  }
});
server.listen(PORT, HOST, () => console.log("ATSR QA Audit running on " + HOST + ":" + PORT + ". Database: " + DB_FILE));
const stop = () => { server.close(); try { sqlite.close(); } catch (e) {} process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);

// Minimal .env reader (KEY=value per line) so the panel's .env file works without extra packages.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
