/**
 * Checks each sport's live data source WITHOUT touching the database tables:
 *   cd /var/www/edgeboard && sudo -u ubuntu npm run sourcecheck
 */
import { getProvider } from "../src/lib/providers";
import { SPORT_IDS } from "../src/lib/sports";

(async () => {
  for (const s of SPORT_IDS) {
    const p = await getProvider(s);
    if (!p) { console.log(`${s}: no source (switched off, or NBA without a balldontlie key)`); continue; }
    const t = await p.testConnection();
    console.log(`${s}: ${t.ok ? "OK  " : "FAIL"} ${t.message}`);
    if (!t.ok) continue;
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
