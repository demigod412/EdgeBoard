# EdgeBoard

Basketball, baseball and ice-hockey probabilities in one PWA: win, totals, handicaps, first-segment totals, team totals and specials (overtime, regulation 3-way, NRFI…), Top 20 (most likely / best value), slips, and a public, append-only accuracy ledger. Not a bookmaker. No guarantees.

## Deploy on Lightsail next to PitchEdge (same server, new subdomain)

**1. DNS (Cloudflare):** add an A record `arena` → your Lightsail static IP, **grey cloud** for now.

**2. Put the code on GitHub:** create an empty repo (e.g. `EdgeBoard`), then on the server:
```bash
cd ~ && rm -rf /tmp/eb && unzip -q edgeboard-v0.4.0.zip -d /tmp/eb
mkdir -p ~/EdgeBoard && rsync -a /tmp/eb/edgeboard/ ~/EdgeBoard/
cd ~/EdgeBoard && git init -b main && git add -A && git commit -m "EdgeBoard v0.4.0"
git remote add origin https://github.com/<you>/EdgeBoard.git && git push -u origin main
```
(Or later on any machine: `git clone https://github.com/<you>/EdgeBoard.git`.)

**3. Install (same script as PitchEdge):**
```bash
cd ~/EdgeBoard && sudo bash ./setup-lightsail.sh
```
Answers: domain `arena.<your-domain>` · www **n** · your e-mail · app name **edgeboard** · source: press Enter (this folder) · Cloudflare token optional · API-Sports key · PIN · demo data **y** · port: accept the suggestion (PitchEdge keeps its own).

**4. Check:** `cd /var/www/edgeboard && sudo -u ubuntu npm run selfcheck -- --demo` → "All checks passed".

**5. Cloudflare:** switch the record to orange, SSL/TLS **Full (strict)**.

## Updating
```bash
cd ~/EdgeBoard && git pull     # or rsync a new zip in, then commit + push
sudo bash ./setup-lightsail.sh update edgeboard
```

## Operations
```bash
cd /var/www/edgeboard && sudo -u ubuntu npm run ingest -- hockey   # sync one sport now (runs outside the web server)
cd /var/www/edgeboard && sudo -u ubuntu npm run selfcheck          # ledger checks
tail -f /var/log/edgeboard-cron.log
```
Cron: sync each sport every 3 h (separate process), lock every 5 min, results every 15 min.
Data (Settings → Data source, per sport):
- Baseball: MLB Stats API (free, no key) · Ice hockey: NHL API (free, no key) · Basketball: balldontlie (free key from app.balldontlie.io)
- Or API-Sports (paid plan needed for current seasons) for bookmaker odds and more leagues.
Check sources on the server: `cd /var/www/<app> && sudo -u ubuntu npm run sourcecheck`
