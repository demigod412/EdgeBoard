import "server-only";
import { fetchJson, qs } from "./http";
import { SPORTS, type SportId } from "../sports";

/* One adapter for API-Sports basketball / baseball / hockey (v1). Same key works across sports on paid plans;
   each sport has its own free plan quota (≈100 requests/day). */
export type PStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
export interface PTeam { externalId: string; name: string; logoUrl?: string }
export interface PGame {
  externalId: string; leagueExternalId: string; startUtc: Date; status: PStatus; home: PTeam; away: PTeam;
  homeScore: number | null; awayScore: number | null; homeReg: number | null; awayReg: number | null;
  homeSeg: number | null; awaySeg: number | null; extraTime: boolean;
  homeFirst?: number | null; awayFirst?: number | null;
}
export interface PLines { total?: number; spread?: number; seg?: number; moneyline?: [number, number]; bookmaker?: string; prices?: Record<string, [number, number]> }

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

export function apiSports(sport: SportId, opts: { key?: string; rapidKey?: string }) {
  const base = process.env[`API_SPORTS_${sport.toUpperCase()}_URL`] ?? SPORTS[sport].apiBase;
  const host = new URL(base).host;
  const headers: Record<string, string> = opts.rapidKey ? { "x-rapidapi-key": opts.rapidKey, "x-rapidapi-host": host } : { "x-apisports-key": opts.key ?? "" };
  const get = async (path: string) => {
    const r = await fetchJson<{ response: AnyObj[]; errors?: AnyObj | unknown[] }>(`api-sports-${sport}`, `${base}${path}`, headers);
    const errs = r.errors && !Array.isArray(r.errors) ? Object.values(r.errors) : [];
    if (errs.length) throw new Error(`api-sports ${sport}: ${errs.join("; ")}`);
    return r.response;
  };
  return {
    sport,
    /** Whole league-season in one request — keeps free-plan usage low. */
    async seasonGames(leagueId: string, season: string): Promise<PGame[]> { return (await get(`/games?${qs({ league: leagueId, season })}`)).map((g) => parse(sport, g)); },
    async gamesOn(date: string): Promise<PGame[]> { return (await get(`/games?${qs({ date, timezone: "UTC" })}`)).map((g) => parse(sport, g)); },
    async game(id: string): Promise<PGame | null> { const r = await get(`/games?id=${id}`); return r[0] ? parse(sport, r[0]) : null; },
    async h2h(homeId: string, awayId: string): Promise<PGame[]> { return (await get(`/games?h2h=${homeId}-${awayId}`)).map((g) => parse(sport, g)); },
    async odds(gameId: string): Promise<PLines> { return parseOdds(sport, await get(`/odds?game=${gameId}`)); },
    async leagues() { return get(`/leagues`); },
    async testConnection() {
      try { const r = await fetchJson<{ response: AnyObj }>(`api-sports-${sport}`, `${base}/status`, headers); const q = r.response?.requests; return { ok: true, message: q ? `${SPORTS[sport].name}: ${q.current}/${q.limit_day} requests today` : `${SPORTS[sport].name}: connected` }; }
      catch (e) { return { ok: false, message: `${SPORTS[sport].name}: ${(e as Error).message}` }; }
    },
  };
}
export type SportProvider = ReturnType<typeof apiSports>;
