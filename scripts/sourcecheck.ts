/**
 * Checks each sport's live data source WITHOUT touching the database tables:
 *   cd /var/www/edgeboard && sudo -u ubuntu npm run sourcecheck
 */
import { getProvider } from "../src/lib/providers";
import { SPORT_IDS } from "../src/lib/sports";
import { getSetting } from "../src/lib/secrets";
import { DEFAULT_SOURCES } from "../src/lib/providers";

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
    if (!t.ok) continue;
    if (p.discoverLeagues) {
      try {
        const ls = await p.discoverLeagues();
        console.log(`   ${ls.length} leagues on your plan:`);
        for (const l of ls) {
          const cur = await p.seasonGames(l.id, l.season ?? p.season(new Date())).catch((e) => e as Error);
          const prev = l.prevSeason ? await p.seasonGames(l.id, l.prevSeason).catch((e) => e as Error) : [];
          const count = (x: unknown) => (Array.isArray(x) ? `${x.length} games (${x.filter((g) => g.status === "FINISHED").length} final, ${x.filter((g) => g.status === "SCHEDULED").length} upcoming)` : `error: ${(x as Error).message}`);
          console.log(`   · ${l.name} — season ${l.season}: ${count(cur)} | previous ${l.prevSeason ?? "-"}: ${count(prev)}`);
        }
      } catch (e) { console.log(`   league lookup failed: ${(e as Error).message}`); }
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
