# EdgeArena (EdgeBoard)

Basketball, baseball and ice-hockey probabilities in one PWA: win, totals (with alternative lines), handicaps and run/puck lines, first-segment totals, team totals and specials (overtime, regulation 3-way, NRFI…), Top 20 (most likely / best value), Blend, slips, an access code, and an append-only accuracy ledger. Not a bookmaker. No guarantees. 18+.

Live: `https://arena.<your-domain>` · app folder `/var/www/<app>` (yours: **edgearena**) · repo `~/EdgeBoard`

---

## 1. Everyday commands

Run these on the server. Replace `edgearena` if you named the app differently.

```bash
# Sync one sport now (own process, site stays fast). Basketball can take 10–30 min on a first run.
cd /var/www/edgearena && sudo -u ubuntu npm run -s ingest -- basketball
cd /var/www/edgearena && sudo -u ubuntu npm run -s ingest -- baseball
cd /var/www/edgearena && sudo -u ubuntu npm run -s ingest -- hockey

# Sync every sport
cd /var/www/edgearena && sudo -u ubuntu npm run -s ingest

# Which data source each sport uses, whether the key works, and every league on your plan
cd /var/www/edgearena && sudo -u ubuntu npm run sourcecheck

# Ledger checks (locks, results, accuracy). Add -- --demo to rebuild demo data and test the whole pipeline.
cd /var/www/edgearena && sudo -u ubuntu npm run selfcheck

# Service and logs
sudo systemctl status edgearena
sudo journalctl -u edgearena -f            # app log
tail -f /var/log/edgearena-cron.log        # scheduled jobs
cat /etc/cron.d/edgearena                  # the schedule itself
```

Scheduled automatically: full sync per sport every 3 hours, lock every 5 minutes, results every 15 minutes.

---

## 2. Adding or changing keys

**The easy way (no SSH): Settings → unlock with your PIN.**
`https://arena.<your-domain>/settings` holds the API-Sports key, the balldontlie key, the data source per sport, which sports to sync, scanner floors and the access code. Press **Save**, then run a sync for that sport (section 1). Keys saved here are encrypted in the database.

**A key set in `.env` always wins over Settings.** The installer writes `API_SPORTS_KEY` there, so change that one on the server:

```bash
sudo nano /var/www/edgearena/.env      # edit the line, Ctrl+O, Enter, Ctrl+X
sudo systemctl restart edgearena
cd /var/www/edgearena && sudo -u ubuntu npm run sourcecheck
```

Or without an editor:
```bash
sudo sed -i "s|^API_SPORTS_KEY=.*|API_SPORTS_KEY=your_new_key|" /var/www/edgearena/.env
sudo systemctl restart edgearena
```

Useful `.env` lines:

| Line | What it does |
|---|---|
| `API_SPORTS_KEY=` | API-Sports key (paid plans: odds + all leagues) |
| `BALLDONTLIE_API_KEY=` | free NBA/WNBA key (only needed for the free basketball source) |
| `MAX_ODDS_CALLS=60` | odds requests per sport per sync (use `8` on a free plan, `60`+ on paid) |
| `BALLDONTLIE_PAGE_DELAY_MS=13000` | spacing for balldontlie's free tier (≈5 requests/minute) |
| `MAX_SEGMENT_DATES=25` | NHL match days back-filled per sync for 1st-period scores |
| `SPORTYBET_ENABLED=false` | switch off Sportybet booking codes |
| `SETTINGS_PIN=` | PIN for the Settings page |
| `CRON_SECRET=` | protects the scheduled-job URLs |

After editing `.env`, always `sudo systemctl restart edgearena`.

**Data source per sport** (Settings → Data source):
- **Free** — baseball: MLB Stats API, hockey: NHL API (no keys); basketball: balldontlie (free key). No bookmaker odds.
- **API-Sports** — needs a paid plan for that sport's current season; adds odds and every league on your plan.
Switching a sport takes effect on its next sync.

---

## 3. Updating the code

```bash
cd ~/EdgeBoard && git pull
sudo bash ./setup-lightsail.sh update edgearena
```
From a zip instead:
```bash
cd ~ && rm -rf /tmp/eb && unzip -q ~/edgeboard-<version>.zip -d /tmp/eb
rsync -a --delete --exclude .git --exclude node_modules --exclude .env /tmp/eb/edgeboard/ ~/EdgeBoard/
cd ~/EdgeBoard && git add -A && git commit -m "<version>" && git push
sudo bash ./setup-lightsail.sh update edgearena
```
The update installs packages, applies database changes, rebuilds, refreshes the schedule and restarts.

---

## 4. Access code

Set, change or remove it in **Settings → Access code** (PIN-protected, always reachable). It covers every page, locks again after 30 minutes of inactivity, and locks the form for 5 minutes after 5 wrong tries. **Lock this device now** signs this device out immediately.

---

## 5. When something looks wrong

| What you see | What it means |
|---|---|
| `"games":0` for a league | that season hasn't started, or your plan doesn't include it — `sourcecheck` shows the season and counts |
| `"lines":0` | no bookmaker odds: free sources have none, and API-Sports odds are only fetched for games within 36 hours |
| `"predictions":0` with games loaded | nothing is scheduled in the next 8 days (off-season or a break) |
| `no source — switched off` | tick the sport under Settings → Sports to sync |
| `no source — set to API-Sports but no key saved` | add the key in Settings or `.env` |
| `429` / `rate limit` | the plan's request limit; lower `MAX_ODDS_CALLS` or wait for the next window |
| demo banner still showing | that sport hasn't completed a live sync yet — run the sync for it |
| Sportybet export fails | Sportybet may block non-Nigerian servers; slip text still copies |

Data: one API-Sports key covers all three sports, each with its own plan and quota. Free official sources cover NBA, WNBA, MLB and NHL only.
