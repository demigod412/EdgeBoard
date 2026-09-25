/**
 * Checks each sport's live data source WITHOUT touching the database tables:
 *   cd /var/www/edgearena && sudo -u ubuntu npm run sourcecheck
 *   cd /var/www/edgearena && sudo -u ubuntu npm run sourcecheck -- --all
 *   cd /var/www/edgearena && sudo -u ubuntu npm run sourcecheck -- --find wnba
 *
 * Leagues are matched by country + name, so a competition the provider spells differently is
 * skipped silently rather than reported as an error. `--all` lists everything your plan returns
 * that is NOT being synced; `--find <text>` prints the raw rows whose name or country contains
 * <text>, with the exact country, type and seasons — which is what you need to fix a mismatch.
 */
import { getProvider } from "../src/lib/providers";
import { SPORT_IDS } from "../src/lib/sports";
import { getSetting } from "../src/lib/secrets";
import { DEFAULT_SOURCES } from "../src/lib/providers";

const argv = process.argv.slice(2);
const showAll = argv.includes("--all");
const findAt = argv.indexOf("--find");
const needle = findAt >= 0 ? (argv[findAt + 1] ?? "").toLowerCase() : "";

(async () => {
  for (const s of SPORT_IDS) {
    const p = await getProvider(s);
    if (!p) {
      const enabled = await getSetting<Record<string, boolean>>("sportsEnabled", {});
      const choice = { ...DEFAULT_SOURCES, ...(await getSetting<Record<string, string>>("sources", {})) }[s];
      console.log(`${s}: no source — ${enabled[s] === false ? "switched off in Settings → Sports to sync" : choice === "api-sports" ? "set to API-Sports but no key saved" : s === "basketball" ? "free source needs a balldontlie key" : "no provider"}`);
      continue;
    }
    const t = await p.testConnection();
    console.log(`${s}: ${t.ok ? "OK  " : "FAIL"} ${t.message} · source ${p.name}`);
    // The source in use is the thing to read first: every sport DEFAULTS to the free source, which
    // carries NBA/WNBA, MLB and the NHL only. A paid API-Sports plan does nothing until you switch
    // that sport over in Settings → Data source.
    if (p.source === "OPEN") console.log(`   (free source — NCAA and the other extra leagues need Settings → Data source → API-Sports)`);
    if (!t.ok) continue;

    // Matched leagues, with the season picked and how many games it returns.
    try {
      const ls = p.discoverLeagues ? await p.discoverLeagues() : p.leagues;
      console.log(`   ${ls.length} leagues ${p.discoverLeagues ? "matched on your plan" : "on this source"}:`);
      for (const l of ls) {
        const cur = await p.seasonGames(l.id, l.season ?? p.season(new Date())).catch((e) => e as Error);
        const prev = l.prevSeason ? await p.seasonGames(l.id, l.prevSeason).catch((e) => e as Error) : [];
        const count = (x: unknown) => (Array.isArray(x) ? `${x.length} games (${x.filter((g) => g.status === "FINISHED").length} final, ${x.filter((g) => g.status === "SCHEDULED").length} upcoming)` : `error: ${(x as Error).message}`);
        console.log(`   · ${l.name} — season ${l.season}: ${count(cur)} | previous ${l.prevSeason ?? "-"}: ${count(prev)}`);
      }
      if (!ls.length) console.log(`   nothing matched — run with --all to see what your plan does return`);
    } catch (e) { console.log(`   league lookup failed: ${(e as Error).message}`); }

    // Diagnostics: what the plan returns that we are NOT syncing, and a raw name search.
    if ((showAll || needle) && p.rawLeagues) {
      try {
        const raw = await p.rawLeagues();
        const synced = new Set((p.discoverLeagues ? await p.discoverLeagues() : p.leagues).map((l) => l.id));
        if (needle) {
          const hit = raw.filter((r) => r.name.toLowerCase().includes(needle) || r.country.toLowerCase().includes(needle));
          console.log(`   --find "${needle}": ${hit.length} row(s) in the raw /leagues response`);
          for (const r of hit) {
            console.log(`   · id ${r.id} · name "${r.name}" · country "${r.country}" · type ${r.type} · ${synced.has(r.id) ? "SYNCED" : "not synced"}`);
            console.log(`     seasons: ${r.seasons.join(", ") || "none"}   (* = flagged current)`);
          }
          if (!hit.length) console.log(`   · nothing in your plan's league list matches "${needle}" for ${s}`);
        }
        if (showAll) {
          const missed = raw.filter((r) => !synced.has(r.id));
          console.log(`   ${missed.length} of ${raw.length} competitions on your plan are NOT synced:`);
          const byCountry = new Map<string, string[]>();
          for (const r of missed) byCountry.set(r.country, [...(byCountry.get(r.country) ?? []), `${r.name}${r.type === "Cup" ? " [cup]" : ""}`]);
          for (const c of [...byCountry.keys()].sort()) console.log(`   · ${c}: ${byCountry.get(c)!.sort().join(", ")}`);
        }
      } catch (e) { console.log(`   raw league lookup failed: ${(e as Error).message}`); }
    } else if ((showAll || needle) && !p.rawLeagues) {
      console.log(`   (--all / --find only work on API-Sports; this source has a fixed league list)`);
    }

    try {
      const today = new Date().toISOString().slice(0, 10), yday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      const [a, b] = [await p.gamesOn(yday), await p.gamesOn(today)];
      const fin = a.filter((g) => g.status === "FINISHED");
      console.log(`   ${yday}: ${a.length} games (${fin.length} final) · ${today}: ${b.length} games`);
      const x = fin[0] ?? a[0] ?? b[0];
      if (x) console.log(`   sample: ${x.away.name} ${x.awayScore ?? "-"} at ${x.home.name} ${x.homeScore ?? "-"} · ${x.status} · seg ${x.awaySeg ?? "-"}-${x.homeSeg ?? "-"} · reg ${x.awayReg ?? "-"}-${x.homeReg ?? "-"}${x.extraTime ? " · OT/extras" : ""}${x.homeFirst != null ? ` · 1st inn ${x.awayFirst}-${x.homeFirst}` : ""}${x.newsReady ? " · probables set" : ""}`);
    } catch (e) { console.log(`   games: ${(e as Error).message}`); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
