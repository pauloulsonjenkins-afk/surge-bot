/**
 * Works out the league form (inplayguru/league-form.ts) from every settled pick, stores it, and backtests whether
 * choosing by league has paid.
 *
 * BACKTEST: picks are taken in the order they arrived; each is judged on the form its strategy had in its league from
 * the picks BEFORE it only, then its result is added. So "green only" is what betting only in green leagues would
 * actually have returned, without the hindsight of knowing which leagues ended up green.
 */
import { leagueIdentity, RECORD_FROM, type EngineDb } from "../storage/engine-db";
import { pricingInputs, settledSince, type ResultRow } from "./winloss";
import { GREEN_FROM, PROVEN_FROM, getStoredLeagueForm, levelOf, passesLeagueFilter, saveStoredLeagueForm, type LeagueFilter, type LeagueForm, type LeagueLevel, type StoredLeagueForm } from "../inplayguru/league-form";
import { log } from "./log";

interface Tally {
  counted: number;
  staked: number;
  profit: number;
  sumR: number;
  sumR2: number;
}
const empty = (): Tally => ({ counted: 0, staked: 0, profit: 0, sumR: 0, sumR2: 0 });
function add(t: Tally, stake: number, profit: number): void {
  t.counted++;
  t.staked += stake;
  t.profit += profit;
  const r = profit / stake;
  t.sumR += r;
  t.sumR2 += r * r;
}

/** The priced picks to judge, in arrival order: each strategy's from its rule change, as its record counts them. */
function pricedPicks(db: EngineDb, rows: ResultRow[]) {
  const { price } = pricingInputs(db);
  const out: Array<{ key: string; leagueKey: string; league: string; country: string | null; at: string; stake: number; profit: number }> = [];
  for (const r of rows) {
    const { key, priced } = price(r);
    if (priced.kind !== "priced" || !(priced.stake > 0)) continue;
    const from = RECORD_FROM[key];
    if (from && r.firstSeenAt < from) continue;
    const id = leagueIdentity(r.competition, r.country);
    out.push({ key, leagueKey: id.key, league: id.league, country: id.country, at: r.firstSeenAt, stake: priced.stake, profit: priced.profit });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Every strategy's form in every league, from all settled picks. */
export function computeLeagueForm(db: EngineDb, rows?: ResultRow[], now = new Date()): StoredLeagueForm {
  const tallies = new Map<string, Map<string, Tally>>();
  const names: StoredLeagueForm["names"] = {};
  for (const p of pricedPicks(db, settledSince(db, null, rows))) {
    let byLeague = tallies.get(p.key);
    if (!byLeague) tallies.set(p.key, (byLeague = new Map()));
    let t = byLeague.get(p.leagueKey);
    if (!t) byLeague.set(p.leagueKey, (t = empty()));
    add(t, p.stake, p.profit);
    names[p.leagueKey] ??= { league: p.league, country: p.country };
  }
  const strategies: StoredLeagueForm["strategies"] = {};
  for (const [key, byLeague] of tallies) {
    strategies[key] = {};
    for (const [lk, t] of byLeague) strategies[key]![lk] = levelOf(t);
  }
  return { at: now.toISOString(), strategies, names };
}

/** Works the form out and stores it for the bet feed and notifications. Never throws. */
export function refreshLeagueForm(db: EngineDb, now = new Date()): StoredLeagueForm | null {
  try {
    const t0 = Date.now();
    const rows = settledSince(db, null);
    const form = computeLeagueForm(db, rows, now);
    saveStoredLeagueForm(db, form);
    db.setSetting(BACKTEST_KEY, JSON.stringify({ at: now.toISOString(), strategies: leagueFilterBacktest(db, rows) }));
    const counts = { proven: 0, green: 0, red: 0 };
    for (const byLeague of Object.values(form.strategies)) for (const f of Object.values(byLeague)) if (f.level !== "grey") counts[f.level]++;
    log.info(`League form: ${counts.proven} proven, ${counts.green} green, ${counts.red} red strategy-in-league records (${Date.now() - t0} ms).`);
    return form;
  } catch (err) {
    log.warn(`League form failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const BACKTEST_KEY = "league_form_backtest";

/** The backtest stored with the last refresh (null before the first). */
export function storedBacktest(db: EngineDb): { at: string; strategies: Record<string, Record<LeagueFilter, FilterBacktest>> } | null {
  try {
    const raw = db.getSetting(BACKTEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** One strategy's leagues for showing: those with a record, best first, and its backtest (GET /internal/leagues/form). */
export function leagueFormReport(db: EngineDb) {
  const form = getStoredLeagueForm(db);
  const bt = storedBacktest(db);
  const strategies: Record<string, { leagues: Array<LeagueForm & { key: string; league: string; country: string | null }>; backtest: Record<LeagueFilter, FilterBacktest> | null }> = {};
  const rank: Record<LeagueLevel, number> = { proven: 0, green: 1, grey: 2, red: 3 };
  for (const [key, byLeague] of Object.entries(form?.strategies ?? {})) {
    const leagues = Object.entries(byLeague).map(([lk, f]) => ({ ...f, key: lk, league: form!.names[lk]?.league ?? lk, country: form!.names[lk]?.country ?? null }));
    leagues.sort((a, b) => rank[a.level] - rank[b.level] || (b.roi ?? 0) - (a.roi ?? 0) || b.n - a.n);
    strategies[key] = { leagues, backtest: bt?.strategies[key] ?? null };
  }
  return { at: form?.at ?? null, greenFrom: GREEN_FROM, provenFrom: PROVEN_FROM, strategies };
}

export interface FilterBacktest {
  /** Picks the filter would have let through, their £ staked and profit, and return per £1. */
  n: number;
  staked: number;
  profit: number;
  roi: number | null;
}

/**
 * What each league filter would have returned for each strategy, judging every pick on the form known before it.
 * "off" is the strategy's whole record (from its rule change) for comparison.
 */
export function leagueFilterBacktest(db: EngineDb, rows?: ResultRow[]): Record<string, Record<LeagueFilter, FilterBacktest>> {
  const out: Record<string, Record<LeagueFilter, FilterBacktest>> = {};
  const running = new Map<string, Tally>();
  const blank = (): FilterBacktest => ({ n: 0, staked: 0, profit: 0, roi: null });
  for (const p of pricedPicks(db, settledSince(db, null, rows))) {
    const id = `${p.key}|${p.leagueKey}`;
    const before = running.get(id) ?? empty();
    const level: LeagueLevel = levelOf(before).level;
    const s = (out[p.key] ??= { off: blank(), notRed: blank(), greenOnly: blank() });
    for (const f of ["off", "notRed", "greenOnly"] as const) {
      if (!passesLeagueFilter(f, level)) continue;
      s[f].n++;
      s[f].staked += p.stake;
      s[f].profit += p.profit;
    }
    add(before, p.stake, p.profit);
    running.set(id, before);
  }
  for (const s of Object.values(out))
    for (const f of Object.values(s)) {
      f.roi = f.staked > 0 ? f.profit / f.staked : null;
      f.staked = Math.round(f.staked * 100) / 100;
      f.profit = Math.round(f.profit * 100) / 100;
    }
  return out;
}

