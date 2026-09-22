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
  defaultSegShare: number; // expected share of full-game scoring in the segment
  apiBase: string;
  season: (d: Date) => string;
  leagues: { id: string; name: string; focus?: boolean }[];
  accent: string;
}

export const SPORTS: Record<SportId, SportConfig> = {
  basketball: {
    id: "basketball", name: "Basketball", unit: "points", handicapName: "Spread", segmentName: "1st half", segmentShort: "1H",
    model: "normal", halfHalfLines: true, totalStep: 1, spreadStep: 1, segStep: 1, ladderWidth: 12, defaultSegShare: 0.505,
    apiBase: "https://v1.basketball.api-sports.io",
    season: (d) => { const y = d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${y + 1}`; },
    leagues: [{ id: "12", name: "NBA", focus: true }, { id: "120", name: "EuroLeague" }],
    accent: "#FF8A3D",
  },
  baseball: {
    id: "baseball", name: "Baseball", unit: "runs", handicapName: "Run line", segmentName: "First 5 innings", segmentShort: "F5",
    model: "count", halfHalfLines: true, totalStep: 1, spreadStep: 1, segStep: 1, ladderWidth: 3, fixedHandicaps: [-1.5, 1.5], altHandicaps: [-4.5, -3.5, -2.5, -1.5, 1.5, 2.5, 3.5, 4.5], defaultSegShare: 0.556,
    apiBase: "https://v1.baseball.api-sports.io",
    season: (d) => String(d.getUTCFullYear()),
    leagues: [{ id: "1", name: "MLB", focus: true }, { id: "5", name: "KBO" }, { id: "2", name: "NPB" }],
    accent: "#7DD3FC",
  },
  hockey: {
    id: "hockey", name: "Ice hockey", unit: "goals", handicapName: "Puck line", segmentName: "1st period", segmentShort: "P1",
    model: "count", halfHalfLines: true, totalStep: 1, spreadStep: 1, segStep: 1, ladderWidth: 2, fixedHandicaps: [-1.5, 1.5], altHandicaps: [-3.5, -2.5, -1.5, 1.5, 2.5, 3.5], defaultSegShare: 0.31,
    apiBase: "https://v1.hockey.api-sports.io",
    season: (d) => String(d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1),
    leagues: [{ id: "57", name: "NHL", focus: true }, { id: "35", name: "KHL" }],
    accent: "#A5B4FC",
  },
};
export const isSport = (s: string): s is SportId => (SPORT_IDS as string[]).includes(s);
