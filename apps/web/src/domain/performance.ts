export type AlertOutcome = "hit" | "miss" | "pending";

/** One alert as the engine records it. `league` is the raw text from the alert, not yet mapped. */
export interface PerformanceAlert {
  id: string;
  firedAt: number; // epoch ms
  league: string;
  /** Country read from the alert's flag emoji, when it had one. Used for leagues not in the catalogue. */
  country?: string | null;
  strategy: string;
  minute: number | null; // match minute when the alert fired, if the alert said
  outcome: AlertOutcome;
}

export interface ResolvedAlert extends PerformanceAlert {
  leagueId: string;
  leagueName: string;
  country: string;
  tier: number; // 0 = not in the catalogue
}

export interface LeagueInfo {
  id: string;
  name: string;
  country: string;
  tier: number;
  /** Other spellings the alert text might use. Matching ignores case, spaces and punctuation. */
  aliases: string[];
}

/**
 * Edit this list to add or fix leagues. Anything an alert names that isn't here
 * still shows up, under "Other", so nothing is dropped.
 */
export const LEAGUE_CATALOGUE: LeagueInfo[] = [
  { id: "eng-1", name: "Premier League", country: "England", tier: 1, aliases: ["English Premier League", "EPL", "England Premier League"] },
  { id: "eng-2", name: "Championship", country: "England", tier: 2, aliases: ["EFL Championship", "English Championship"] },
  { id: "eng-3", name: "League One", country: "England", tier: 3, aliases: ["EFL League One", "English League 1"] },
  { id: "eng-4", name: "League Two", country: "England", tier: 4, aliases: ["EFL League Two", "English League 2"] },
  { id: "sco-1", name: "Scottish Premiership", country: "Scotland", tier: 1, aliases: ["Scotland Premiership", "Premiership"] },
  { id: "sco-2", name: "Scottish Championship", country: "Scotland", tier: 2, aliases: ["Scotland Championship"] },
  { id: "ger-1", name: "Bundesliga", country: "Germany", tier: 1, aliases: ["German Bundesliga", "1. Bundesliga"] },
  { id: "ger-2", name: "2. Bundesliga", country: "Germany", tier: 2, aliases: ["Bundesliga 2", "German 2. Bundesliga"] },
  { id: "esp-1", name: "La Liga", country: "Spain", tier: 1, aliases: ["Spanish La Liga", "LaLiga", "Primera Division"] },
  { id: "esp-2", name: "Segunda División", country: "Spain", tier: 2, aliases: ["La Liga 2", "LaLiga 2", "Segunda Division"] },
  { id: "ita-1", name: "Serie A", country: "Italy", tier: 1, aliases: ["Italian Serie A"] },
  { id: "ita-2", name: "Serie B", country: "Italy", tier: 2, aliases: ["Italian Serie B"] },
  { id: "fra-1", name: "Ligue 1", country: "France", tier: 1, aliases: ["French Ligue 1"] },
  { id: "fra-2", name: "Ligue 2", country: "France", tier: 2, aliases: ["French Ligue 2"] },
  { id: "ned-1", name: "Eredivisie", country: "Netherlands", tier: 1, aliases: ["Dutch Eredivisie"] },
  { id: "por-1", name: "Primeira Liga", country: "Portugal", tier: 1, aliases: ["Portuguese Primeira Liga", "Liga Portugal"] },
  { id: "int-concacaf-nl", name: "CONCACAF Nations League", country: "International", tier: 0, aliases: ["Concacaf Nations League"] },
  { id: "int-uefa-nl", name: "UEFA Nations League", country: "International", tier: 0, aliases: ["Nations League"] },
];

export const OTHER_COUNTRY = "Other";

export const TIER_LABEL: Record<number, string> = {
  0: "Unlisted or international",
  1: "Top flight",
  2: "Second tier",
  3: "Third tier",
  4: "Fourth tier",
};

export const MINUTE_BUCKETS = [
  { label: "0–15", from: 0, to: 15 },
  { label: "16–30", from: 16, to: 30 },
  { label: "31–45", from: 31, to: 45 },
  { label: "46–60", from: 46, to: 60 },
  { label: "61–75", from: 61, to: 75 },
  { label: "76+", from: 76, to: 200 },
] as const;

/** Below this many settled alerts, a hit rate is flagged as too small to trust. */
export const LOW_SAMPLE = 15;

export type LeagueFilter =
  | { type: "all" }
  | { type: "country"; country: string }
  | { type: "tier"; tier: number }
  | { type: "league"; leagueId: string };

export type Grouping = "country" | "tier";
