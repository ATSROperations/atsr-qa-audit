# Running the QA app on the Hetzner server

The same app as on Cloudflare, same features and access rules. A small Node.js program (`server/server.mjs`) serves the app and runs the API on a SQLite database file. Nginx sits in front and handles the domain and HTTPS. Nothing to install inside the app: it only uses what ships with Node.js.

Needs on the server: Ubuntu or Debian, root (sudo) access, Node.js 22.13 or newer, Nginx, git, certbot. About 30 minutes.

## What lives where

| | Path |
|---|---|
| Code (a git clone of the GitHub repo) | `/opt/atsr-qa-audit/app` |
| Database (one file) and backups | `/var/lib/atsr-qa-audit/qa.db`, `/var/lib/atsr-qa-audit/backups/` |
| Settings (secrets) | `/etc/atsr-qa-audit.env` |
| Service | `atsr-qa-audit` (systemd), listening on 127.0.0.1:3000 only |
| Nginx site | `/etc/nginx/sites-available/audit.atsrpl.com.au` |
| Logs | `journalctl -u atsr-qa-audit` |

Backups: the app writes a copy of the database to `backups/` at every start and every 24 hours, keeping the newest 30. Add `/var/lib/atsr-qa-audit` to the server's own backup as well.

## 1. Install the basics

```bash
sudo apt update
sudo apt install -y nginx git certbot python3-certbot-nginx curl
# Node.js 22 LTS (skip if `node -v` already shows 22.13+ or 24.x)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

## 2. Create the user, folders and code

```bash
sudo useradd --system --home /opt/atsr-qa-audit --shell /usr/sbin/nologin atsrqa
sudo mkdir -p /opt/atsr-qa-audit /var/lib/atsr-qa-audit
sudo chown atsrqa:atsrqa /opt/atsr-qa-audit /var/lib/atsr-qa-audit
sudo chmod 750 /var/lib/atsr-qa-audit
```

The GitHub repo `ATSROperations/atsr-qa-audit` is private, so the server needs read access. Easiest: in GitHub, repo > Settings > Deploy keys > Add deploy key (read-only). Make the key on the server first:

```bash
sudo -H -u atsrqa ssh-keygen -t ed25519 -N "" -f /opt/atsr-qa-audit/.ssh/id_ed25519 -C "hetzner-atsr-qa"
sudo cat /opt/atsr-qa-audit/.ssh/id_ed25519.pub     # paste this into GitHub as the deploy key
sudo -H -u atsrqa git clone git@github.com:ATSROperations/atsr-qa-audit.git /opt/atsr-qa-audit/app
```

(Answer `yes` to the GitHub host key question.)

## 3. Settings

```bash
sudo cp /opt/atsr-qa-audit/app/deploy/atsr-qa-audit.env.example /etc/atsr-qa-audit.env
sudo chmod 600 /etc/atsr-qa-audit.env
sudo nano /etc/atsr-qa-audit.env
```

| Variable | Value |
|---|---|
| `AUTH_PEPPER` | **The same value as the `AUTH_PEPPER` secret on Cloudflare.** That is what makes the existing passwords work. Never change it afterwards. |
| `OWNER_INITIAL_PASSWORD` | Any one-time password. Only used if the database has no logins. |
| `DATA_DIR`, `PORT`, `HOST`, `OWNER_EMAIL` | Leave as in the example. |

If nobody has the Cloudflare `AUTH_PEPPER` written down (Cloudflare does not show secrets again after saving), set a new long random value here (`openssl rand -base64 36`) and import the data with `--skip-users` in step 6. The owner then signs in with `OWNER_INITIAL_PASSWORD` and recreates the 2-3 auditor logins. All audits, team members and roles still come across.

## 4. Start the app as a service

```bash
cd /opt/atsr-qa-audit/app
sudo cp deploy/atsr-qa-audit.service deploy/atsr-qa-update.service deploy/atsr-qa-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now atsr-qa-audit
sudo systemctl enable --now atsr-qa-update.timer
sudo systemctl status atsr-qa-audit --no-pager
curl http://127.0.0.1:3000/healthz        # prints: ok
```

The timer checks GitHub every 5 minutes and restarts the app when `main` has a new commit, so Rikuo's updates go live without anyone logging in to the server. To update by hand: `sudo /opt/atsr-qa-audit/app/deploy/update.sh`.

## 5. Nginx and HTTPS

First the DNS: in GoDaddy, `atsrpl.com.au` needs an **A record** `audit` pointing to this server's public IP. (Not a CNAME to Cloudflare. If one was added earlier, replace it.) Wait until `ping audit.atsrpl.com.au` answers from the server's IP.

```bash
sudo cp /opt/atsr-qa-audit/app/deploy/nginx-audit.atsrpl.com.au.conf /etc/nginx/sites-available/audit.atsrpl.com.au
sudo ln -s /etc/nginx/sites-available/audit.atsrpl.com.au /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d audit.atsrpl.com.au      # choose redirect HTTP -> HTTPS when asked
```

Open https://audit.atsrpl.com.au. The sign-in screen should appear. Certbot renews the certificate on its own.

If the server has a firewall: ports 80 and 443 must be open. Port 3000 must not be (the app only listens on 127.0.0.1 anyway).

## 6. Move the data from Cloudflare

1. Pick a quiet time and ask the auditors not to save audits until the switch is done.
2. Rikuo, on the current site: sign in as the owner > Backup (link bottom right of the home page) > **Full export (for moving servers)**. It downloads `atsr-qa-full-export-<date>.json`. It contains password hashes: send it privately and delete it afterwards.
3. Copy the file to the server, e.g. `scp atsr-qa-full-export-*.json user@server:/tmp/`.
4. Import:
   ```bash
   sudo systemctl stop atsr-qa-audit
   cd /opt/atsr-qa-audit/app
   sudo -H -u atsrqa env DATA_DIR=/var/lib/atsr-qa-audit node --disable-warning=ExperimentalWarning server/import.mjs /tmp/atsr-qa-full-export-*.json
   sudo systemctl start atsr-qa-audit
   sudo rm /tmp/atsr-qa-full-export-*.json
   ```
   Add `--skip-users` if the pepper was not carried over. The import refuses to run into a database that already has data unless `--force` is added, and takes a safety backup first if so.
5. Sign in on https://audit.atsrpl.com.au with the usual passwords and check the audits are there.
6. Rikuo: in Cloudflare, remove the custom domain from the Pages project. Once everyone uses the new address, delete the Pages project and the D1 database.

## Day to day

- Update the app: commit to GitHub; live within 5 minutes. The database is never touched by updates.
- Logs: `sudo journalctl -u atsr-qa-audit -n 100 --no-pager`
- Restart: `sudo systemctl restart atsr-qa-audit`
- Restore a backup: `sudo systemctl stop atsr-qa-audit`, copy the chosen file from `/var/lib/atsr-qa-audit/backups/` over `/var/lib/atsr-qa-audit/qa.db` (and delete `qa.db-wal` and `qa.db-shm` if present), `sudo systemctl start atsr-qa-audit`.
- Server updates (`apt upgrade`, Node.js) are the usual server housekeeping; the app has no other dependencies.
