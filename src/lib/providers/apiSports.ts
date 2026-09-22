import "server-only";
import { fetchJson, qs } from "./http";
import { SPORTS, type SportId } from "../sports";

/* One adapter for API-Sports basketball / baseball / hockey (v1). Same key works across sports on paid plans;
   each sport has its own free plan quota (≈100 requests/day). */
import type { LeagueRef, PGame, PLines, PStatus, SportProvider } from "./types";
export type { PGame, PLines, SportProvider } from "./types";

type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
const FIN: Record<SportId, string[]> = { basketball: ["FT", "AOT"], baseball: ["FT"], hockey: ["FT", "AOT", "AP"] };
const LIVE = ["Q1", "Q2", "Q3", "Q4", "OT", "BT", "HT", "P1", "P2", "P3", "BT", "PT", "IN1", "IN2", "IN3", "IN4", "IN5", "IN6", "IN7", "IN8", "IN9", "LIVE"];

function parse(sport: SportId, g: AnyObj): PGame {
  const short: string = g.status?.short ?? "NS";
  const status: PStatus = FIN[sport].includes(short) ? "FINISHED" : LIVE.includes(short) ? "LIVE"
    : short === "POST" ? "POSTPONED" : ["CANC", "ABD", "AWD", "WO", "INTR"].includes(short) ? "CANCELLED" : "SCHEDULED";
  const base: Omit<PGame, "homeScore" | "awayScore" | "homeReg" | "awayReg" | "homeSeg" | "awaySeg" | "extraTime"> = {
    externalId: String(g.id), leagueExternalId: String(g.league?.id), startUtc: new Date(g.date), status,
    home: { externalId: String(g.teams.home.id), name: g.teams.home.name, logoUrl: g.teams.home.logo },
    away: { externalId: String(g.teams.away.id), name: g.teams.away.name, logoUrl: g.teams.away.logo },
  };
  if (sport === "basketball") {
    const h = g.scores?.home ?? {}, a = g.scores?.away ?? {};
    const ot = n(h.over_time) != null || n(a.over_time) != null;
    const hs = n(h.total), as = n(a.total);
    return { ...base, homeScore: hs, awayScore: as, extraTime: ot,
      homeReg: hs != null ? hs - (n(h.over_time) ?? 0) : null, awayReg: as != null ? as - (n(a.over_time) ?? 0) : null,
      homeSeg: n(h.quarter_1) != null && n(h.quarter_2) != null ? n(h.quarter_1)! + n(h.quarter_2)! : null,
      awaySeg: n(a.quarter_1) != null && n(a.quarter_2) != null ? n(a.quarter_1)! + n(a.quarter_2)! : null };
  }
  if (sport === "baseball") {
    const inn = (s: AnyObj, from: number, to: number) => { let t = 0; for (let i = from; i <= to; i++) { const v = n(s?.innings?.[String(i)]); if (v == null) return null; t += v; } return t; };
    const h = g.scores?.home ?? {}, a = g.scores?.away ?? {};
    const extra = n(h.innings?.extra) != null || n(a.innings?.extra) != null;
    // home team does not bat in the bottom 9th when leading: treat a missing 9th as 0 for regulation
    const reg = (s: AnyObj) => { const f8 = inn(s, 1, 8); return f8 == null ? null : f8 + (n(s?.innings?.["9"]) ?? 0); };
    return { ...base, homeScore: n(h.total), awayScore: n(a.total), extraTime: extra,
      homeReg: reg(h), awayReg: reg(a), homeSeg: inn(h, 1, 5), awaySeg: inn(a, 1, 5), homeFirst: n(h.innings?.["1"]), awayFirst: n(a.innings?.["1"]) };
  }
  // hockey: scores are ints; periods are "h-a" strings
  const per = (k: string) => { const v: string | null = g.periods?.[k]; if (!v) return null; const [x, y] = v.split("-").map(Number); return [x, y] as const; };
  const p1 = per("first"), p2 = per("second"), p3 = per("third");
  const extra = !!(g.periods?.overtime || g.periods?.penalties);
  return { ...base, homeScore: n(g.scores?.home), awayScore: n(g.scores?.away), extraTime: extra,
    homeReg: p1 && p2 && p3 ? p1[0] + p2[0] + p3[0] : null, awayReg: p1 && p2 && p3 ? p1[1] + p2[1] + p3[1] : null,
    homeSeg: p1 ? p1[0] : null, awaySeg: p1 ? p1[1] : null };
}

/** Main line = the line whose two prices are closest to each other. Bet names differ by sport; matched loosely. */
export function parseOdds(sport: SportId, resp: AnyObj[]): PLines {
  const books: AnyObj[] = resp[0]?.bookmakers ?? [];
  const segRe = sport === "basketball" ? /1st half|first half/i : sport === "baseball" ? /5 innings|first 5/i : /1st period/i;
  const out: PLines = { prices: {} };
  for (const b of books) {
    for (const bet of (b.bets ?? []) as AnyObj[]) {
      const name: string = bet.name ?? ""; const vals: { value: string; odd: string }[] = bet.values ?? [];
      const isSeg = segRe.test(name), isOU = /over\/under/i.test(name), isHcp = /handicap|run line|puck line|spread/i.test(name);
      // Moneyline incl. OT / extras: "Home/Away" (2-way). Hockey's "3Way Result" is regulation-only and skipped here.
      if (/^home\/away$/i.test(name.trim()) && !out.moneyline) {
        const h = Number(vals.find((v) => /home/i.test(v.value))?.odd), a = Number(vals.find((v) => /away/i.test(v.value))?.odd);
        if (h > 1 && a > 1) { out.moneyline = [h, a]; out.bookmaker ??= b.name; }
        continue;
      }
      if (isOU && !/team|home|away|quarter|2nd|3rd|4th|inning(?!s)/i.test(name.replace(segRe, ""))) {
        const lines = new Map<number, { o?: number; u?: number }>();
        vals.forEach((v) => { const m = v.value.match(/(over|under)\s*([\d.]+)/i); if (!m) return; const l = Number(m[2]); const e = lines.get(l) ?? {}; if (/over/i.test(m[1])) e.o = Number(v.odd); else e.u = Number(v.odd); lines.set(l, e); });
        const best = [...lines].filter(([, e]) => e.o && e.u).sort((x, y) => Math.abs(x[1].o! - x[1].u!) - Math.abs(y[1].o! - y[1].u!))[0];
        if (best) { const key = isSeg ? "seg" : "total"; if (out[key] == null) { out[key] = best[0]; out.prices![key] = [best[1].o!, best[1].u!]; out.bookmaker ??= b.name; } }
      } else if (isHcp && !isSeg) {
        const lines = new Map<number, { h?: number; a?: number }>();
        vals.forEach((v) => { const m = v.value.match(/(home|away)\s*([+-]?[\d.]+)/i); if (!m) return; const side = m[1].toLowerCase(); const l = Number(m[2]); const key = side === "home" ? l : -l; const e = lines.get(key) ?? {}; if (side === "home") e.h = Number(v.odd); else e.a = Number(v.odd); lines.set(key, e); });
        const best = [...lines].filter(([, e]) => e.h && e.a).sort((x, y) => Math.abs(x[1].h! - x[1].a!) - Math.abs(y[1].h! - y[1].a!))[0];
        if (best && out.spread == null) { out.spread = best[0]; out.prices!.spread = [best[1].h!, best[1].a!]; out.bookmaker ??= b.name; }
      }
    }
  }
  return out;
}

/** Top leagues wanted per sport: [country, league-name pattern, focus]. Only those on your plan are used. */
export const WANTED: Record<SportId, [string, RegExp, boolean?][]> = {
  basketball: [
    ["USA", /^NBA$/i, true], ["USA", /^WNBA$/i, true], ["USA", /^NCAA(\b|$)/i],
    ["Europe", /^Euroleague$/i, true], ["Europe", /^Eurocup$/i], ["Europe", /^Champions League$/i], ["Europe", /^ABA League$|^Adriatic League$/i],
    ["Spain", /^ACB$|^Liga Endesa$/i], ["Turkey", /^Super Lig|^BSL$/i], ["Italy", /^Lega A$|^Serie A$/i], ["Greece", /^Basket League$|^A1$/i],
    ["France", /^LNB$|^Pro A$|^Betclic Elite$/i], ["Germany", /^BBL$/i], ["Lithuania", /^LKL$/i], ["Israel", /^Super League$|^Winner League$/i],
    ["Russia", /^VTB United League$|^Super League$/i], ["Poland", /^(PLK|Energa Basket Liga|Superliga)$/i], ["Serbia", /^Super League$|^KLS$/i],
    ["Czech-Republic", /^NBL$/i], ["Croatia", /^Premijer liga$|^A1 Liga$/i], ["Slovenia", /^Liga Nova KBM$|^Premier A$/i], ["Belgium", /^BNXT League$|^Pro Basketball League$/i],
    ["Portugal", /^LPB$|^Proliga$/i], ["Netherlands", /^DBL$|^BNXT League$/i], ["Finland", /^Korisliiga$/i], ["Sweden", /^Basketligan$/i], ["Denmark", /^Basketligaen$/i],
    ["Switzerland", /^SB League$/i], ["Austria", /^Superliga$|^Basketball Bundesliga$/i], ["Hungary", /^NB I\.? A$/i], ["Romania", /^Divizia A$|^Liga Nationala$/i],
    ["Bulgaria", /^NBL$/i], ["Ukraine", /^Superleague$/i], ["Latvia", /^LBL$/i], ["Estonia", /^KML$/i],
    ["Japan", /^B\.?League$/i], ["South-Korea", /^KBL$/i], ["Philippines", /^PBA$/i], ["China", /^CBA$/i], ["Australia", /^NBL$/i], ["New-Zealand", /^NBL$/i],
    ["Argentina", /^Liga A$|^Liga Nacional$/i], ["Brazil", /^NBB$/i], ["Mexico", /^LNBP$/i], ["Uruguay", /^Liga Uruguaya$|^LUB$/i], ["Chile", /^LNB$/i], ["Venezuela", /^Superliga$/i],
    ["Canada", /^CEBL$/i], ["Taiwan", /^(P\.? ?LEAGUE\+?|T1 League)$/i],
  ],
  baseball: [
    ["USA", /^MLB$/i, true], ["Japan", /^NPB$/i, true], ["South-Korea", /^KBO$/i, true], ["Taiwan", /^CPBL$/i], ["Mexico", /^LMB$/i], ["Mexico", /^LMP$/i],
    ["Dominican-Republic", /^LIDOM$/i], ["Venezuela", /^LVBP$/i], ["Puerto-Rico", /^LBPRC$|^Liga de B(é|e)isbol/i], ["Colombia", /^LCBP$|^Liga Colombiana/i],
    ["Panama", /^Probeis$/i], ["Nicaragua", /^LBPN$/i], ["Cuba", /^Serie Nacional$/i], ["Australia", /^ABL$/i], ["Netherlands", /^Hoofdklasse$/i], ["Italy", /^Serie A$/i],
    ["China", /^CBL$/i], ["USA", /^MiLB$|^Minor League/i],
  ],
  hockey: [
    ["USA", /^NHL$/i, true], ["Russia", /^KHL$/i, true], ["Sweden", /^SHL$/i, true], ["Finland", /^Liiga$/i, true], ["Germany", /^DEL$/i],
    ["Czech-Republic", /^Extraliga$|^Chance Liga$/i], ["Switzerland", /^National League$/i], ["USA", /^AHL$/i], ["USA", /^ECHL$/i],
    ["Austria", /^(ICE Hockey League|EBEL|Bundesliga)$/i], ["Slovakia", /^Extraliga$/i], ["Norway", /^Eliteserien$|^Fjordkraft-ligaen$/i], ["Denmark", /^Metal Ligaen$|^Superisligaen$/i],
    ["Poland", /^Polska Hokej Liga$|^PHL$/i], ["Latvia", /^Optibet Hokeja Liga$|^OHL$/i], ["Belarus", /^Extraleague$/i], ["Kazakhstan", /^Championship$|^Pro Hokei Ligasy$/i],
    ["France", /^Ligue Magnus$/i], ["Italy", /^(Alps Hockey League|IHL|Serie A)$/i], ["United-Kingdom", /^EIHL$|^Elite League$/i], ["Sweden", /^HockeyAllsvenskan$/i],
    ["Finland", /^Mestis$/i], ["Switzerland", /^Swiss League$/i], ["Germany", /^DEL2$/i], ["Hungary", /^Erste Liga$/i], ["Romania", /^Liga Nationala$/i],
    ["Japan", /^Asia League$/i], ["China", /^Asia League$/i],
  ],
};

export function apiSports(sport: SportId, opts: { key?: string; rapidKey?: string }): SportProvider {
  const base = process.env[`API_SPORTS_${sport.toUpperCase()}_URL`] ?? SPORTS[sport].apiBase;
  const host = new URL(base).host;
  const headers: Record<string, string> = opts.rapidKey ? { "x-rapidapi-key": opts.rapidKey, "x-rapidapi-host": host } : { "x-apisports-key": opts.key ?? "" };
  const get = async (path: string) => {
    const r = await fetchJson<{ response: AnyObj[]; errors?: AnyObj | unknown[] }>(`api-sports-${sport}`, `${base}${path}`, headers);
    const errs = r.errors && !Array.isArray(r.errors) ? Object.values(r.errors) : [];
    if (errs.length) throw new Error(`api-sports ${sport}: ${errs.join("; ")}`);
    return r.response;
  };
  const cfg = SPORTS[sport];
  return {
    sport, source: "API_SPORTS", name: "API-Sports", leagues: cfg.leagues,
    season: (now: Date) => cfg.season(now),
    prevSeason: (season: string) => (/-/.test(season) ? season.split("-").map((y) => String(Number(y) - 1)).join("-") : String(Number(season) - 1)),
    async discoverLeagues(): Promise<LeagueRef[]> {
      type L = { id: number; name: string; type?: string; country?: { name?: string }; seasons?: { season: string | number; current?: boolean }[] };
      const all = (await get(`/leagues`)) as unknown as L[];
      const out: LeagueRef[] = [];
      for (const [country, re, focus] of WANTED[sport]) {
        const l = all.find((x) => (x.country?.name ?? "").toLowerCase() === country.toLowerCase() && re.test(x.name.trim()) && (x.type ?? "League") !== "Cup");
        if (!l?.seasons?.length) continue;
        const seasons = l.seasons.map((x) => ({ s: String(x.season), cur: !!x.current }));
        const i = Math.max(0, seasons.findIndex((x) => x.cur) >= 0 ? seasons.findIndex((x) => x.cur) : seasons.length - 1);
        out.push({ id: String(l.id), name: l.name, focus: !!focus, season: seasons[i].s, prevSeason: seasons[i - 1]?.s });
      }
      return out;
    },
    /** Whole league-season in one request — keeps free-plan usage low. */
    async seasonGames(leagueId: string, season: string): Promise<PGame[]> { return (await get(`/games?${qs({ league: leagueId, season })}`)).map((g) => parse(sport, g)); },
    async gamesOn(date: string): Promise<PGame[]> { return (await get(`/games?${qs({ date, timezone: "UTC" })}`)).map((g) => parse(sport, g)); },
    async odds(gameId: string): Promise<PLines> { return parseOdds(sport, await get(`/odds?game=${gameId}`)); },
    async testConnection() {
      try { const r = await fetchJson<{ response: AnyObj }>(`api-sports-${sport}`, `${base}/status`, headers); const q = r.response?.requests; return { ok: true, message: q ? `${SPORTS[sport].name}: ${q.current}/${q.limit_day} requests today` : `${SPORTS[sport].name}: connected` }; }
      catch (e) { return { ok: false, message: `${SPORTS[sport].name}: ${(e as Error).message}` }; }
    },
  };
}
