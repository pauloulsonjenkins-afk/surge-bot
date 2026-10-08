/**
 * TRIAL (added 2026-10-08): this League history feature may be rolled back. It is self-contained: this file,
 * the /internal/history routes in server/http.ts, startHistoryRefresh in server/main.ts, and on the website the
 * history page, its /api/admin/history routes, use-history.ts and its entries in admin-sections, More and the layout.
 *
 * Past match results and prices from football-data.co.uk (free CSV files), used for two things on the admin site:
 *   - league profiles: how often the home side wins, draws, goals, first-half goals, corners, per league;
 *   - testing a pre-match strategy on years of real matches before risking money (Away Win Lay first).
 *
 * The files are downloaded once and kept on the container's disk and in memory, NOT in the engine database: they are
 * large, they can always be downloaded again, and the database is backed up after every change. A redeploy wipes the
 * disk, so they are fetched again (slowly, one file at a time) the next time they are needed.
 *
 * Main leagues: one CSV per league per season (mmz4281/2526/E0.csv), with half-time scores, match stats and many
 * bookmakers' odds, including the Betfair Exchange ("BFE") and closing prices (a "C" after the bookmaker, e.g. PSCA).
 * Extra leagues: one CSV per country holding every season (new/ARG.csv), full-time result and closing odds only.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { log } from "../server/log";

const BASE = "https://football-data.co.uk";
const CACHE_DIR = join(process.env.FOOTBALL_DATA_DIR ?? join(tmpdir(), "goalbrew-football-data"));
/** How many seasons back, counting the current one. */
export const SEASONS = 6;
/** A file for the current season is downloaded again after this long; past seasons never change. */
const CURRENT_MAX_AGE_MS = 24 * 3_600_000;
/** Pause between downloads, to be gentle with a free site. */
const GAP_MS = 400;

export interface Division {
  code: string;
  name: string;
  country: string;
  /** "main" = per-season files with half-time scores and stats; "extra" = one file per country, results and odds only. */
  kind: "main" | "extra";
}

export const DIVISIONS: Division[] = [
  { code: "E0", name: "Premier League", country: "England", kind: "main" },
  { code: "E1", name: "Championship", country: "England", kind: "main" },
  { code: "E2", name: "League One", country: "England", kind: "main" },
  { code: "E3", name: "League Two", country: "England", kind: "main" },
  { code: "EC", name: "National League", country: "England", kind: "main" },
  { code: "SC0", name: "Premiership", country: "Scotland", kind: "main" },
  { code: "SC1", name: "Championship", country: "Scotland", kind: "main" },
  { code: "SC2", name: "League One", country: "Scotland", kind: "main" },
  { code: "SC3", name: "League Two", country: "Scotland", kind: "main" },
  { code: "D1", name: "Bundesliga", country: "Germany", kind: "main" },
  { code: "D2", name: "2. Bundesliga", country: "Germany", kind: "main" },
  { code: "I1", name: "Serie A", country: "Italy", kind: "main" },
  { code: "I2", name: "Serie B", country: "Italy", kind: "main" },
  { code: "SP1", name: "La Liga", country: "Spain", kind: "main" },
  { code: "SP2", name: "Segunda División", country: "Spain", kind: "main" },
  { code: "F1", name: "Ligue 1", country: "France", kind: "main" },
  { code: "F2", name: "Ligue 2", country: "France", kind: "main" },
  { code: "N1", name: "Eredivisie", country: "Netherlands", kind: "main" },
  { code: "B1", name: "Pro League", country: "Belgium", kind: "main" },
  { code: "P1", name: "Primeira Liga", country: "Portugal", kind: "main" },
  { code: "T1", name: "Süper Lig", country: "Turkey", kind: "main" },
  { code: "G1", name: "Super League", country: "Greece", kind: "main" },
  { code: "ARG", name: "Primera División", country: "Argentina", kind: "extra" },
  { code: "AUT", name: "Bundesliga", country: "Austria", kind: "extra" },
  { code: "BRA", name: "Série A", country: "Brazil", kind: "extra" },
  { code: "CHN", name: "Super League", country: "China", kind: "extra" },
  { code: "DNK", name: "Superliga", country: "Denmark", kind: "extra" },
  { code: "FIN", name: "Veikkausliiga", country: "Finland", kind: "extra" },
  { code: "IRL", name: "Premier Division", country: "Ireland", kind: "extra" },
  { code: "JPN", name: "J1 League", country: "Japan", kind: "extra" },
  { code: "MEX", name: "Liga MX", country: "Mexico", kind: "extra" },
  { code: "NOR", name: "Eliteserien", country: "Norway", kind: "extra" },
  { code: "POL", name: "Ekstraklasa", country: "Poland", kind: "extra" },
  { code: "ROU", name: "Liga I", country: "Romania", kind: "extra" },
  { code: "RUS", name: "Premier League", country: "Russia", kind: "extra" },
  { code: "SWE", name: "Allsvenskan", country: "Sweden", kind: "extra" },
  { code: "SWZ", name: "Super League", country: "Switzerland", kind: "extra" },
  { code: "USA", name: "MLS", country: "USA", kind: "extra" },
];

export interface HistoricMatch {
  div: string;
  /** The season it belongs to, by its starting year (2025 = 2025/26). */
  season: number;
  /** YYYY-MM-DD. */
  date: string;
  home: string;
  away: string;
  fthg: number;
  ftag: number;
  hthg: number | null;
  htag: number | null;
  corners: number | null;
  /** Prices for home, draw and away, best source first (see oddsFrom); null when the file has none. */
  odds: { home: number; draw: number; away: number; source: string } | null;
}

// --------------------------------------------------------------------------- parsing

/** Splits one CSV line, allowing quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "05/10/26" or "05/10/2026" -> "2026-10-05". */
function isoDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

/** The season a date falls in: July onwards starts a new one. Calendar-year leagues (Brazil, Sweden...) use the year. */
function seasonOf(date: string, calendarYear: boolean): number {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return calendarYear || m >= 7 ? y : y - 1;
}

/** Betfair Exchange closing, then Betfair Exchange, then Pinnacle closing, Pinnacle, market average closing, average. */
const ODDS_SOURCES: Array<{ cols: [string, string, string]; label: string }> = [
  { cols: ["BFECH", "BFECD", "BFECA"], label: "Betfair Exchange (closing)" },
  { cols: ["BFEH", "BFED", "BFEA"], label: "Betfair Exchange" },
  { cols: ["PSCH", "PSCD", "PSCA"], label: "Pinnacle (closing)" },
  { cols: ["PSH", "PSD", "PSA"], label: "Pinnacle" },
  { cols: ["AvgCH", "AvgCD", "AvgCA"], label: "Market average (closing)" },
  { cols: ["AvgH", "AvgD", "AvgA"], label: "Market average" },
];

function oddsFrom(get: (c: string) => string | undefined): HistoricMatch["odds"] {
  for (const s of ODDS_SOURCES) {
    const [h, d, a] = s.cols.map((c) => Number(get(c)));
    if ([h, d, a].every((x) => Number.isFinite(x) && x! > 1)) return { home: h!, draw: d!, away: a!, source: s.label };
  }
  return null;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Reads one downloaded file into matches. Rows without a full-time score (not played yet) are left out. */
export function parseCsv(text: string, div: Division, minSeason: number): HistoricMatch[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]!).map((h) => h.trim());
  const idx = new Map(head.map((h, i) => [h, i]));
  const calendarYear = div.kind === "extra" && ["BRA", "CHN", "FIN", "IRL", "JPN", "NOR", "SWE", "USA"].includes(div.code);
  const out: HistoricMatch[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const get = (c: string) => {
      const i = idx.get(c);
      return i === undefined ? undefined : cells[i];
    };
    const date = isoDate(get("Date") ?? "");
    const home = (get("HomeTeam") ?? get("Home") ?? "").trim();
    const away = (get("AwayTeam") ?? get("Away") ?? "").trim();
    const fthg = num(get("FTHG") ?? get("HG"));
    const ftag = num(get("FTAG") ?? get("AG"));
    if (!date || !home || !away || fthg === null || ftag === null) continue;
    // Extra leagues name the season ("2025/2026" or "2025"); otherwise it's worked out from the date.
    const named = /^(\d{4})/.exec(get("Season") ?? "");
    const season = named ? Number(named[1]) : seasonOf(date, calendarYear);
    if (season < minSeason) continue;
    const hc = num(get("HC"));
    const ac = num(get("AC"));
    out.push({
      div: div.code,
      season,
      date,
      home,
      away,
      fthg,
      ftag,
      hthg: num(get("HTHG")),
      htag: num(get("HTAG")),
      corners: hc !== null && ac !== null ? hc + ac : null,
      odds: oddsFrom(get),
    });
  }
  return out;
}

// --------------------------------------------------------------------------- downloading

/** The season starting this year, or last year before July. */
export function currentSeason(now = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const seasonCode = (start: number) => `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;

interface FileJob {
  div: Division;
  url: string;
  file: string;
  /** Downloaded again once a day; finished seasons are kept as they are. */
  live: boolean;
}

function jobs(now: Date): FileJob[] {
  const cur = currentSeason(now);
  const out: FileJob[] = [];
  for (const div of DIVISIONS) {
    if (div.kind === "extra") {
      out.push({ div, url: `${BASE}/new/${div.code}.csv`, file: `${div.code}.csv`, live: true });
      continue;
    }
    for (let s = cur - SEASONS + 1; s <= cur; s++) {
      out.push({ div, url: `${BASE}/mmz4281/${seasonCode(s)}/${div.code}.csv`, file: `${div.code}-${seasonCode(s)}.csv`, live: s === cur });
    }
  }
  return out;
}

export interface HistoryStatus {
  state: "idle" | "loading" | "ready" | "failed";
  /** Files done / to do in the current load. */
  done: number;
  total: number;
  matches: number;
  loadedAt: string | null;
  errors: string[];
}

let matches: HistoricMatch[] = [];
let status: HistoryStatus = { state: "idle", done: 0, total: 0, matches: 0, loadedAt: null, errors: [] };
let loading: Promise<void> | null = null;

export function historyStatus(): HistoryStatus {
  return { ...status, errors: [...status.errors] };
}

export function historyMatches(): HistoricMatch[] {
  return matches;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function download(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "GoalBrew (league history)" } });
    if (res.status === 404) return ""; // a league or season the site doesn't have
    if (!res.ok) throw new Error(`${res.status}`);
    // Newer files are UTF-8, older ones Windows-1252 (team names with accents).
    const bytes = await res.arrayBuffer();
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads every file, from the disk cache when it is fresh enough, otherwise from the site. Only one load runs at a time;
 * calling again while one runs returns the same one. `force` downloads the current season's files again now.
 */
export function loadHistory(opts: { force?: boolean; now?: Date } = {}): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const now = opts.now ?? new Date();
    const list = jobs(now);
    const minSeason = currentSeason(now) - SEASONS + 1;
    status = { ...status, state: "loading", done: 0, total: list.length, errors: [] };
    mkdirSync(CACHE_DIR, { recursive: true });
    const all: HistoricMatch[] = [];
    for (const job of list) {
      const path = join(CACHE_DIR, job.file);
      let text: string | null = null;
      try {
        const fresh = existsSync(path) && (!job.live || (!opts.force && now.getTime() - statSync(path).mtimeMs < CURRENT_MAX_AGE_MS));
        if (fresh) text = readFileSync(path, "utf8");
        else {
          text = await download(job.url);
          writeFileSync(path, text, "utf8");
          await sleep(GAP_MS);
        }
      } catch (err) {
        // Keep an older copy if there is one; a failed download isn't worth losing a season for.
        if (existsSync(path)) text = readFileSync(path, "utf8");
        status.errors.push(`${job.div.country} ${job.div.name} (${job.file}): ${err instanceof Error ? err.message : String(err)}`);
      }
      if (text) all.push(...parseCsv(text, job.div, minSeason));
      status.done++;
    }
    matches = all;
    status = { ...status, state: all.length > 0 ? "ready" : "failed", matches: all.length, loadedAt: new Date().toISOString() };
    log.info(`League history: ${all.length} matches from ${list.length} files${status.errors.length ? `, ${status.errors.length} could not be downloaded` : ""}.`);
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Loads a few minutes after start, then refreshes the current season once a day. */
export function startHistoryRefresh(): void {
  const run = () => void loadHistory().catch((err) => log.warn(`League history load failed: ${err instanceof Error ? err.message : String(err)}`));
  setTimeout(run, 3 * 60_000).unref?.();
  setInterval(run, CURRENT_MAX_AGE_MS).unref?.();
}

// --------------------------------------------------------------------------- league profiles

export interface LeagueProfile {
  code: string;
  name: string;
  country: string;
  matches: number;
  seasons: number;
  homePct: number;
  drawPct: number;
  awayPct: number;
  /** Home win % minus away win %: the bigger, the stronger the home advantage. */
  homeEdge: number;
  avgGoals: number;
  over25Pct: number;
  bttsPct: number;
  /** Matches with a goal before half-time; null when the files have no half-time scores. */
  firstHalfGoalPct: number | null;
  avgCorners: number | null;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((1000 * n) / d) / 10 : 0);

export function leagueProfiles(list: HistoricMatch[] = matches, seasons = SEASONS, now = new Date()): LeagueProfile[] {
  const from = currentSeason(now) - seasons + 1;
  const out: LeagueProfile[] = [];
  for (const div of DIVISIONS) {
    const ms = list.filter((m) => m.div === div.code && m.season >= from);
    if (ms.length === 0) continue;
    const n = ms.length;
    const home = ms.filter((m) => m.fthg > m.ftag).length;
    const draw = ms.filter((m) => m.fthg === m.ftag).length;
    const away = n - home - draw;
    const ht = ms.filter((m) => m.hthg !== null && m.htag !== null);
    const corners = ms.filter((m) => m.corners !== null);
    out.push({
      code: div.code,
      name: div.name,
      country: div.country,
      matches: n,
      seasons: new Set(ms.map((m) => m.season)).size,
      homePct: pct(home, n),
      drawPct: pct(draw, n),
      awayPct: pct(away, n),
      homeEdge: Math.round((pct(home, n) - pct(away, n)) * 10) / 10,
      avgGoals: Math.round((100 * ms.reduce((s, m) => s + m.fthg + m.ftag, 0)) / n) / 100,
      over25Pct: pct(ms.filter((m) => m.fthg + m.ftag > 2).length, n),
      bttsPct: pct(ms.filter((m) => m.fthg > 0 && m.ftag > 0).length, n),
      firstHalfGoalPct: ht.length >= n / 2 ? pct(ht.filter((m) => m.hthg! + m.htag! > 0).length, ht.length) : null,
      avgCorners: corners.length >= n / 2 ? Math.round((10 * corners.reduce((s, m) => s + m.corners!, 0)) / corners.length) / 10 : null,
    });
  }
  return out;
}

// --------------------------------------------------------------------------- Away Win Lay test

export interface LayTestOptions {
  /** Only matches where the away side's price is in this range. */
  minOdds: number;
  maxOdds: number;
  /** Betfair commission on winnings, 0.02 = 2%. */
  commission: number;
  /** How much worse the lay price is than the back price in the files (the exchange's gap), 0.02 = 2%. */
  spread: number;
  seasons: number;
  /** Only these leagues; empty = all. */
  divisions: string[];
}

export const DEFAULT_LAY_TEST: LayTestOptions = { minOdds: 2.5, maxOdds: 6, commission: 0.02, spread: 0.02, seasons: SEASONS, divisions: [] };

export interface LayTestRow {
  bets: number;
  /** Bets won: the away side didn't win. */
  won: number;
  /** Profit for £1 of liability on every bet. */
  profit: number;
  /** Profit per £1 of liability risked, as a percentage. */
  roi: number;
  avgOdds: number;
}

export interface LayTestResult {
  options: LayTestOptions;
  total: LayTestRow;
  byLeague: Array<LayTestRow & { code: string; name: string; country: string; oddsSource: string }>;
  bySeason: Array<LayTestRow & { season: number }>;
  /** Matches in range that had no price, left out. */
  noPrice: number;
}

function row(results: Array<{ profit: number; won: boolean; odds: number }>): LayTestRow {
  const bets = results.length;
  const profit = results.reduce((s, r) => s + r.profit, 0);
  return {
    bets,
    won: results.filter((r) => r.won).length,
    profit: Math.round(profit * 100) / 100,
    roi: bets > 0 ? Math.round((1000 * profit) / bets) / 10 : 0,
    avgOdds: bets > 0 ? Math.round((100 * results.reduce((s, r) => s + r.odds, 0)) / bets) / 100 : 0,
  };
}

/**
 * Lays the away side in every past match whose away price is in range, risking £1 (the liability) each time:
 *   lay price L = away price x (1 + spread); lay stake = 1 / (L - 1)
 *   away side doesn't win: + lay stake x (1 - commission);  away side wins: - £1
 * Prices are the best the file has (Betfair Exchange where it exists, otherwise Pinnacle or the market average), all
 * taken before kick-off, so it is a fair stand-in for a pre-match lay. It can't see the price you would actually have
 * got or whether there was enough money to match, so treat it as a guide.
 */
export function testAwayLay(opts: Partial<LayTestOptions> = {}, list: HistoricMatch[] = matches, now = new Date()): LayTestResult {
  const o: LayTestOptions = { ...DEFAULT_LAY_TEST, ...opts };
  const from = currentSeason(now) - o.seasons + 1;
  const wanted = new Set(o.divisions);
  const picked: Array<{ m: HistoricMatch; profit: number; won: boolean; odds: number }> = [];
  let noPrice = 0;
  for (const m of list) {
    if (m.season < from || (wanted.size > 0 && !wanted.has(m.div))) continue;
    if (!m.odds) {
      noPrice++;
      continue;
    }
    if (m.odds.away < o.minOdds || m.odds.away > o.maxOdds) continue;
    const lay = m.odds.away * (1 + o.spread);
    const stake = 1 / (lay - 1);
    const won = m.ftag <= m.fthg;
    picked.push({ m, odds: m.odds.away, won, profit: won ? stake * (1 - o.commission) : -1 });
  }
  const byLeague = DIVISIONS.flatMap((d) => {
    const rs = picked.filter((p) => p.m.div === d.code);
    if (rs.length === 0) return [];
    const sources = new Map<string, number>();
    for (const r of rs) sources.set(r.m.odds!.source, (sources.get(r.m.odds!.source) ?? 0) + 1);
    const oddsSource = [...sources.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    return [{ code: d.code, name: d.name, country: d.country, oddsSource, ...row(rs) }];
  }).sort((a, b) => b.roi - a.roi);
  const seasons = [...new Set(picked.map((p) => p.m.season))].sort();
  return {
    options: o,
    total: row(picked),
    byLeague,
    bySeason: seasons.map((s) => ({ season: s, ...row(picked.filter((p) => p.m.season === s)) })),
    noPrice,
  };
}
