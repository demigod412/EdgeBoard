/** Everything that differs between sports lives here; the UI and pipeline read from this table. */
export type SportId = "basketball" | "baseball" | "hockey";
export const SPORT_IDS: SportId[] = ["basketball", "baseball", "hockey"];
export const SPORT_ENUM = { basketball: "BASKETBALL", baseball: "BASEBALL", hockey: "HOCKEY" } as const;

export interface SportConfig {
  id: SportId;
  name: string;
  unit: string;            // "points" | "runs" | "goals"
  handicapName: string;    // Spread | Run line | Puck line
  segmentName: string;     // 1st half | First 5 innings | 1st period
  segmentShort: string;    // 1H | F5 | P1
  model: "normal" | "count";
  halfHalfLines: boolean;  // true where books quote .5 lines only
  totalStep: number; spreadStep: number; segStep: number;
  ladderWidth: number;     // how many steps either side of the fair line
  fixedHandicaps?: number[]; // baseball/hockey: ±1.5 is the main line
  altHandicaps?: number[];   // extra run / puck lines offered as markets (home perspective)
  altTotals: number[];       // alternative total lines offered, as offsets from the main line
  altSegs: number[];         // same for the first-segment total
  teamAlt: number[];         // team-total lines, as offsets from the team's expected score
  defaultSegShare: number; // expected share of full-game scoring in the segment
  /**
   * Roughly how long a game runs, wall-clock, including breaks and a normal amount of overtime.
   * Used both to decide a game should have ended (results job) and which board tab it belongs in.
   */
  liveMinutes: number;
  apiBase: string;
  season: (d: Date) => string;
  leagues: { id: string; name: string; country?: string; focus?: boolean }[];
  accent: string;
}

export const SPORTS: Record<SportId, SportConfig> = {
  basketball: {
    id: "basketball", name: "Basketball", unit: "points", handicapName: "Spread", segmentName: "1st half", segmentShort: "1H",
    model: "normal", halfHalfLines: true, totalStep: 1, spreadStep: 1, segStep: 1, ladderWidth: 12, defaultSegShare: 0.505, altTotals: [-12, -8, -4, 0, 4, 8, 12], altSegs: [-6, -3, 0, 3, 6], teamAlt: [-6, -3, 0, 3, 6],
    liveMinutes: 150,
    apiBase: "https://v1.basketball.api-sports.io",
    season: (d) => { const y = d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${y + 1}`; },
    leagues: [{ id: "12", name: "NBA", country: "USA", focus: true }, { id: "120", name: "EuroLeague", country: "Europe" }],
    accent: "#FF8A3D",
  },
  baseball: {
    id: "baseball", name: "Baseball", unit: "runs", handicapName: "Run line", segmentName: "First 5 innings", segmentShort: "F5",
    model: "count", halfHalfLines: true, totalStep: 1, spreadStep: 1, segStep: 1, ladderWidth: 3, fixedHandicaps: [-1.5, 1.5], altHandicaps: [-4.5, -3.5, -2.5, -1.5, 1.5, 2.5, 3.5, 4.5], defaultSegShare: 0.556, altTotals: [-2, -1, 0, 1, 2], altSegs: [-1, 0, 1], teamAlt: [-1, 0, 1],
    liveMinutes: 200,
    apiBase: "https://v1.baseball.api-sports.io",
    season: (d) => String(d.getUTCFullYear()),
    leagues: [{ id: "1", name: "MLB", country: "USA", focus: true }, { id: "5", name: "KBO", country: "South-Korea" }, { id: "2", name: "NPB", country: "Japan" }],
    accent: "#7DD3FC",
  },
  hockey: {
    id: "hockey", name: "Ice hockey", unit: "goals", handicapName: "Puck line", segmentName: "1st period", segmentShort: "P1",
    model: "count", halfHalfLines: true, totalStep: 1, spreadStep: 1, segStep: 1, ladderWidth: 2, fixedHandicaps: [-1.5, 1.5], altHandicaps: [-3.5, -2.5, -1.5, 1.5, 2.5, 3.5], defaultSegShare: 0.31, altTotals: [-1, 0, 1, 2], altSegs: [-1, 0, 1], teamAlt: [-1, 0, 1],
    liveMinutes: 160,
    apiBase: "https://v1.hockey.api-sports.io",
    season: (d) => String(d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1),
    leagues: [{ id: "57", name: "NHL", country: "USA", focus: true }, { id: "35", name: "KHL", country: "Russia" }],
    accent: "#A5B4FC",
  },
};
export const isSport = (s: string): s is SportId => (SPORT_IDS as string[]).includes(s);

/**
 * Provider names that read badly on screen. API-Sports files the women's NBA as "NBA W" and
 * hyphenates the G League; nobody calls them that. Display only — matching and the stored
 * league name still use the provider's own string.
 */
const DISPLAY_NAME: Record<string, string> = {
  "NBA W": "WNBA",
  "NBA - G League": "NBA G League",
};

/**
 * "Lithuania · LKL". Country first because league names repeat constantly across countries —
 * NBL is Australia, New Zealand, Czechia and Bulgaria; Super League is Israel, Serbia, Iran and
 * Uzbekistan; A2 is Greece and Italy. The bare name is ambiguous once more than a few leagues sync.
 */
export const leagueLabel = (l: { name: string; country?: string | null }) => {
  const name = DISPLAY_NAME[l.name] ?? l.name;
  return l.country ? `${l.country.replace(/-/g, " ")} · ${name}` : name;
};
