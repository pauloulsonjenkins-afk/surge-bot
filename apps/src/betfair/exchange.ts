/**
 * Reads your bets straight from Betfair, so the site knows within a minute whether a pick sent to the betting software
 * was actually placed and matched (the bet history import only covers settled bets, after the match).
 *
 * READ ONLY. This module calls only listCurrentOrders, listClearedOrders, listMarketCatalogue, listEvents,
 * listMarketBook and listCompetitions. It has no code that places, changes or cancels a bet, and must never be given any.
 *
 * It also looks each new alert's match up on Betfair (listEvents), so the Leagues page can list leagues whose matches
 * aren't on the exchange, and Live can say "Not on exchange" as soon as such an alert arrives. When the match is there,
 * it also reads the current back price of the bet the feed would send (same market and selection, see feedMarket), so
 * strategies whose alerts carry no price (Both Teams to Score, First Half Goal...) can be priced, Sim picks included.
 *
 * Settings (engine environment variables, the same names the old surge_live.py used):
 *   BF_APP_KEY                   your Betfair application key (the delayed key is fine)
 *   BF_USERNAME, BF_PASSWORD     your Betfair login
 *   BF_CERT_B64, BF_KEY_B64      the login certificate and its private key, base64-encoded
 *                                (or BF_CERT_PEM and BF_KEY_PEM holding the PEM text itself)
 * Until all are set the poller stays off and the site says so.
 *
 * Every POLL_MS it fetches orders placed in the last day (open and matched) and orders settled in the last day (won,
 * lost, lapsed, cancelled, voided), stores them in betfair_bets keyed by bet id (the same id BF Bot Manager's export
 * uses, so both sources update one record) and links them to picks (matchBets).
 */
import { request as httpsRequest } from "node:https";
import type { BetfairBet, EngineDb } from "../storage/engine-db";
import { eventScore, matchBets } from "./reconcile";
import { exchangeNamer, feedMarket, getSendingSettings, kickoffAt } from "../inplayguru/bet-feed";
import { log } from "../server/log";
import { notifyUnplaced, UNPLACED_AFTER_MS } from "./unplaced";

const LOGIN_URL = "https://identitysso-cert.betfair.com/api/certlogin";
const API_URL = "https://api.betfair.com/exchange/betting/rest/v1.0/";
const POLL_MS = 45_000;
/** How often the list of competitions Betfair offers is saved. */
const COMPETITIONS_EVERY_MS = 6 * 60 * 60 * 1000;
/** A Betfair session lasts hours; log in again well before it would run out. */
const SESSION_MS = 3 * 60 * 60 * 1000;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface Credentials {
  appKey: string;
  username: string;
  password: string;
  cert: string;
  key: string;
}

function decodeMaybeB64(b64: string | undefined, pem: string | undefined): string | null {
  if (pem?.trim()) return pem.replace(/\\n/g, "\n");
  if (!b64?.trim()) return null;
  try {
    return Buffer.from(b64.replace(/\s+/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function readCredentials(env = process.env): Credentials | null {
  const appKey = env.BF_APP_KEY?.trim();
  const username = env.BF_USERNAME?.trim();
  const password = env.BF_PASSWORD;
  const cert = decodeMaybeB64(env.BF_CERT_B64, env.BF_CERT_PEM);
  const key = decodeMaybeB64(env.BF_KEY_B64, env.BF_KEY_PEM);
  if (!appKey || !username || !password || !cert || !key) return null;
  return { appKey, username, password, cert, key };
}

/** Which settings are missing, by name, for the status message. */
export function missingSettings(env = process.env): string[] {
  const missing: string[] = [];
  if (!env.BF_APP_KEY?.trim()) missing.push("BF_APP_KEY");
  if (!env.BF_USERNAME?.trim()) missing.push("BF_USERNAME");
  if (!env.BF_PASSWORD) missing.push("BF_PASSWORD");
  if (!env.BF_CERT_B64?.trim() && !env.BF_CERT_PEM?.trim()) missing.push("BF_CERT_B64");
  if (!env.BF_KEY_B64?.trim() && !env.BF_KEY_PEM?.trim()) missing.push("BF_KEY_B64");
  return missing;
}

function post(url: string, body: string, headers: Record<string, string>, tls?: { cert: string; key: string }): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(body) }, timeout: 20_000, ...(tls ?? {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("Betfair did not answer within 20 seconds.")));
    req.on("error", reject);
    req.end(body);
  });
}

// ---- Betfair's shapes (only the fields used) ----

export interface CurrentOrder {
  betId: string;
  marketId: string;
  selectionId: number;
  side: "BACK" | "LAY";
  status: "EXECUTABLE" | "EXECUTION_COMPLETE";
  priceSize?: { price: number; size: number };
  placedDate?: string;
  averagePriceMatched?: number;
  sizeMatched?: number;
  sizeRemaining?: number;
  sizeLapsed?: number;
  sizeCancelled?: number;
  sizeVoided?: number;
  customerStrategyRef?: string;
}

export interface ClearedOrder {
  betId: string;
  marketId: string;
  selectionId: number;
  side?: "BACK" | "LAY";
  placedDate?: string;
  settledDate?: string;
  betOutcome?: string;
  priceMatched?: number;
  priceRequested?: number;
  sizeSettled?: number;
  sizeCancelled?: number;
  profit?: number;
  customerStrategyRef?: string;
  itemDescription?: { eventDesc?: string; marketDesc?: string; runnerDesc?: string };
}

export interface MarketCatalogue {
  marketId: string;
  marketName?: string;
  event?: { name?: string };
  runners?: Array<{ selectionId: number; runnerName: string }>;
}

/** Betfair's open and settled orders as stored bets. Settled records win over open ones for the same bet. */
export function toStoredBets(currentOrders: CurrentOrder[], cleared: ClearedOrder[], catalogue: Map<string, MarketCatalogue>): BetfairBet[] {
  const bets = new Map<string, BetfairBet>();
  for (const o of currentOrders) {
    const m = catalogue.get(o.marketId);
    const matched = o.sizeMatched ?? 0;
    bets.set(o.betId, {
      betId: o.betId,
      placedAt: o.placedDate ?? null,
      settledAt: null,
      event: m?.event?.name ?? `Market ${o.marketId}`,
      market: m?.marketName ?? null,
      selection: m?.runners?.find((r) => r.selectionId === o.selectionId)?.runnerName ?? null,
      side: o.side.toLowerCase(),
      provider: o.customerStrategyRef ?? null,
      status: matched > 0 ? "matched" : o.status === "EXECUTABLE" ? "pending" : "unmatched",
      stake: o.priceSize?.size ?? null,
      matched,
      odds: o.averagePriceMatched && o.averagePriceMatched > 1 ? o.averagePriceMatched : null,
      profit: null,
    });
  }
  // Settled records win over open ones for the same bet.
  for (const o of cleared) {
    const outcome = (o.betOutcome ?? "").toUpperCase();
    const status: BetfairBet["status"] =
      outcome === "WON" || outcome === "PLACE" ? "won" : outcome === "LOST" ? "lost" : outcome === "VOIDED" ? "void" : "unmatched";
    const prev = bets.get(o.betId);
    bets.set(o.betId, {
      betId: o.betId,
      placedAt: o.placedDate ?? prev?.placedAt ?? null,
      settledAt: o.settledDate ?? null,
      event: o.itemDescription?.eventDesc ?? prev?.event ?? `Market ${o.marketId}`,
      market: o.itemDescription?.marketDesc ?? prev?.market ?? null,
      selection: o.itemDescription?.runnerDesc ?? prev?.selection ?? null,
      side: o.side ? o.side.toLowerCase() : (prev?.side ?? null),
      provider: o.customerStrategyRef ?? prev?.provider ?? null,
      status,
      stake: prev?.stake ?? o.sizeSettled ?? null,
      matched: status === "unmatched" ? 0 : (o.sizeSettled ?? prev?.matched ?? null),
      odds: o.priceMatched && o.priceMatched > 1 ? o.priceMatched : (prev?.odds ?? null),
      profit: status === "unmatched" || status === "void" ? 0 : (o.profit ?? null),
    });
  }
  return [...bets.values()];
}

export class BetfairReader {
  private session: { token: string; at: number } | null = null;
  private catalogue = new Map<string, MarketCatalogue>();

  constructor(private readonly creds: Credentials) {}

  private async login(): Promise<string> {
    const body = new URLSearchParams({ username: this.creds.username, password: this.creds.password }).toString();
    const res = await post(LOGIN_URL, body, { "X-Application": this.creds.appKey, "Content-Type": "application/x-www-form-urlencoded" }, { cert: this.creds.cert, key: this.creds.key });
    let parsed: { sessionToken?: string; loginStatus?: string } = {};
    try {
      parsed = JSON.parse(res.text) as typeof parsed;
    } catch {
      throw new Error(`Betfair login failed (HTTP ${res.status}).`);
    }
    if (parsed.loginStatus !== "SUCCESS" || !parsed.sessionToken) {
      throw new Error(`Betfair login refused: ${parsed.loginStatus ?? `HTTP ${res.status}`}.`);
    }
    this.session = { token: parsed.sessionToken, at: Date.now() };
    return parsed.sessionToken;
  }

  private async call<T>(
    operation: "listCurrentOrders" | "listClearedOrders" | "listMarketCatalogue" | "listEvents" | "listMarketBook" | "listCompetitions",
    params: unknown,
    retried = false,
  ): Promise<T> {
    const token = this.session && Date.now() - this.session.at < SESSION_MS ? this.session.token : await this.login();
    const res = await post(`${API_URL}${operation}/`, JSON.stringify(params), {
      "X-Application": this.creds.appKey,
      "X-Authentication": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    if (res.status === 200) return JSON.parse(res.text) as T;
    // An expired session: log in once more and try again.
    if (!retried && /INVALID_SESSION|NO_SESSION/.test(res.text)) {
      this.session = null;
      return this.call<T>(operation, params, true);
    }
    const code = /"errorCode"\s*:\s*"([A-Z_]+)"/.exec(res.text)?.[1];
    throw new Error(`Betfair ${operation} failed: ${code ?? `HTTP ${res.status}`}.`);
  }

  /** Event, market and runner names for markets not seen yet (open orders carry only ids). */
  private async names(marketIds: string[]): Promise<void> {
    const wanted = [...new Set(marketIds)].filter((id) => !this.catalogue.has(id));
    for (let i = 0; i < wanted.length; i += 40) {
      const chunk = wanted.slice(i, i + 40);
      const list = await this.call<MarketCatalogue[]>("listMarketCatalogue", {
        filter: { marketIds: chunk },
        marketProjection: ["EVENT", "RUNNER_DESCRIPTION"],
        maxResults: chunk.length,
      });
      for (const m of list) this.catalogue.set(m.marketId, m);
    }
  }

  /** Every football competition Betfair lists right now (those with upcoming or live matches). */
  async footballCompetitions(): Promise<Array<{ id: string; name: string; region: string | null; marketCount: number }>> {
    const r = await this.call<Array<{ competition: { id: string; name: string }; marketCount?: number; competitionRegion?: string }>>("listCompetitions", {
      filter: { eventTypeIds: ["1"] },
    });
    return r.map((c) => ({ id: c.competition.id, name: c.competition.name, region: c.competitionRegion ?? null, marketCount: c.marketCount ?? 0 }));
  }

  /** Football events on Betfair whose names contain this text, starting from 8 hours ago to 36 hours ahead of `at`. */
  async searchEvents(text: string, at: Date): Promise<Array<{ id: string; name: string }>> {
    const query = text.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
    if (!query) return [];
    const r = await this.call<Array<{ event: { id: string; name: string } }>>("listEvents", {
      filter: {
        eventTypeIds: ["1"],
        textQuery: query,
        marketStartTime: { from: new Date(at.getTime() - 8 * 3_600_000).toISOString(), to: new Date(at.getTime() + 36 * 3_600_000).toISOString() },
      },
    });
    return r.map((e) => ({ id: e.event.id, name: e.event.name }));
  }

  /** The corner markets Betfair offers for an event: name, market code, selections (and ids, for reading a price). */
  async cornerMarkets(eventId: string): Promise<Array<CornerMarket & { marketId: string; runners: Array<{ selectionId: number; runnerName: string }> }>> {
    return (await this.marketsNamed(eventId, "Corner")).filter((m) => /corner/i.test(m.name));
  }

  /** An event's markets whose names contain this text (e.g. "Corner", or a team's name), with codes and selections. */
  async marketsNamed(eventId: string, text: string): Promise<Array<CornerMarket & { marketId: string; runners: Array<{ selectionId: number; runnerName: string }> }>> {
    const markets = await this.call<Array<MarketCatalogue & { description?: { marketType?: string } }>>("listMarketCatalogue", {
      filter: { eventIds: [eventId], textQuery: text },
      marketProjection: ["MARKET_DESCRIPTION", "RUNNER_DESCRIPTION"],
      maxResults: 50,
    });
    return markets
      .map((m) => ({
        name: m.marketName ?? "",
        code: m.description?.marketType ?? "",
        selections: (m.runners ?? []).slice(0, 4).map((r) => r.runnerName),
        marketId: m.marketId,
        runners: m.runners ?? [],
      }));
  }

  /**
   * The best price available to back a selection right now, in one market of an event (by Betfair's market code, e.g.
   * BOTH_TEAMS_TO_SCORE), or null when the market or selection isn't there or has no price.
   */
  async backPrice(eventId: string, marketType: string, selectionName: string): Promise<number | null> {
    return (await this.checkBet(eventId, marketType, selectionName)).price;
  }

  /**
   * Whether Betfair has the exact bet the feed sends for this event (its market code, then its selection wording) and
   * the price of it now. The betting software finds the bet by these same names, so "noMarket" or "noSelection" means
   * it can't place it: the market code or wording on the Sending page doesn't match Betfair's.
   */
  async checkBet(eventId: string, marketType: string, selectionName: string): Promise<{ status: MarketCheck; price: number | null; runners: string[] }> {
    const markets = await this.call<MarketCatalogue[]>("listMarketCatalogue", {
      filter: { eventIds: [eventId], marketTypeCodes: [marketType] },
      marketProjection: ["RUNNER_DESCRIPTION"],
      maxResults: 5,
    });
    const market = markets[0];
    if (!market) return { status: "noMarket", price: null, runners: [] };
    const runners = (market.runners ?? []).map((r) => r.runnerName);
    const runner = market.runners ? findRunner(market.runners, selectionName) : undefined;
    if (!runner) return { status: "noSelection", price: null, runners };
    return { status: "ok", price: await this.priceOf(market.marketId, runner.selectionId), runners };
  }

  /** The best back price of one selection in one market right now (else its last traded price), or null. */
  async priceOf(marketId: string, selectionId: number): Promise<number | null> {
    const books = await this.call<Array<{ runners?: Array<{ selectionId: number; lastPriceTraded?: number; ex?: { availableToBack?: Array<{ price: number }> } }> }>>(
      "listMarketBook",
      { marketIds: [marketId], priceProjection: { priceData: ["EX_BEST_OFFERS"] } },
    );
    const r = books[0]?.runners?.find((x) => x.selectionId === selectionId);
    const price = r?.ex?.availableToBack?.[0]?.price ?? r?.lastPriceTraded ?? null;
    return price !== null && price > 1 ? price : null;
  }

  /** Every bet placed or settled in the last day, in the stored shape. */
  async recentBets(now = new Date()): Promise<BetfairBet[]> {
    const from = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const current = await this.call<{ currentOrders: CurrentOrder[] }>("listCurrentOrders", {
      dateRange: { from },
      orderProjection: "ALL",
      orderBy: "BY_PLACE_TIME",
      recordCount: 1000,
    });
    const cleared: ClearedOrder[] = [];
    for (const betStatus of ["SETTLED", "LAPSED", "CANCELLED", "VOIDED"] as const) {
      const r = await this.call<{ clearedOrders: ClearedOrder[] }>("listClearedOrders", {
        betStatus,
        settledDateRange: { from },
        includeItemDescription: true,
        recordCount: 1000,
      });
      for (const o of r.clearedOrders) cleared.push({ ...o, betOutcome: betStatus === "SETTLED" ? o.betOutcome : betStatus });
    }
    await this.names(current.currentOrders.map((o) => o.marketId));

    return toStoredBets(current.currentOrders, cleared, this.catalogue);
  }
}

// ---------------------------------------------------------------------------
// Is the match on Betfair?

/**
 * What Betfair's event list says about a match: on (both teams match an event), nameDiffers (only one team does, so
 * Betfair spells the other differently: a Match names entry fixes it), or off (no event for either team).
 */
export function judgeExchange(
  home: string,
  away: string,
  events: Array<string | { id: string; name: string }>,
): { result: "on" | "nameDiffers" | "off"; event: string | null; eventId: string | null } {
  let best: { score: number; name: string; id: string | null } | null = null;
  for (const e of events) {
    const name = typeof e === "string" ? e : e.name;
    const score = eventScore(name, `${home} v ${away}`);
    if (!best || score > best.score) best = { score, name, id: typeof e === "string" ? null : e.id };
  }
  if (best?.score === 2) return { result: "on", event: best.name, eventId: best.id };
  if (best?.score === 1) return { result: "nameDiffers", event: best.name, eventId: best.id };
  return { result: "off", event: null, eventId: null };
}

/** The runner whose name matches the feed's selection wording, ignoring case, punctuation and word order. */
export function findRunner<T extends { runnerName: string }>(runners: T[], selectionName: string): T | undefined {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim().split(" ").sort().join(" ");
  const want = words(selectionName);
  return runners.find((r) => r.runnerName.trim().toLowerCase() === selectionName.trim().toLowerCase()) ?? runners.find((r) => words(r.runnerName) === want);
}

/** Words that say nothing about which club it is. */
const COMMON = new Set(["fc", "afc", "cf", "sc", "ac", "fk", "sk", "cd", "club", "united", "city", "town", "real", "sporting", "deportivo", "atletico", "athletic", "women", "u17", "u18", "u19", "u20", "u21", "u23", "reserves", "res"]);

/**
 * The word to search Betfair for: the team's longest distinctive word ("Wigan" for "Wigan Athletic U21"). One word finds
 * the event however the rest of the name is written; judgeExchange then checks both teams properly.
 */
export function searchWord(team: string): string {
  const words = team.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 3);
  const distinctive = words.filter((w) => !COMMON.has(w.toLowerCase()));
  const pool = distinctive.length > 0 ? distinctive : words;
  return pool.sort((a, b) => b.length - a.length)[0] ?? team;
}

/** Alerts are looked up while their match is still listed: Betfair drops an event soon after it finishes. */
const CHECK_WITHIN_MS = 90 * 60 * 1000;
const CHECKS_PER_POLL = 10;

/** Whether Betfair has the bet the feed would send for an alert's match: see BetfairReader.checkBet. */
export type MarketCheck = "ok" | "noMarket" | "noSelection";

export interface CornerMarket {
  name: string;
  /** The market code the bet feed would need, e.g. FIRST_HALF_CORNERS. */
  code: string;
  selections: string[];
}

const CORNER_MARKETS_KEY = "betfair_corner_markets";
const TEAM_MARKETS_KEY = "betfair_team_markets";

/**
 * Corner markets seen on Betfair for First Half Corner Race alerts, by code, newest first. The strategy can't be sent
 * until its exact market is known; this shows what Betfair actually offers so it can be chosen.
 */
export function cornerMarketsSeen(db: EngineDb): Array<CornerMarket & { seenAt: string; example: string }> {
  return marketsSeen(db, CORNER_MARKETS_KEY);
}

/**
 * Team goal markets seen on Betfair for the favourite in "Pass Master 1st half" alerts (favourite to score again), by
 * code, newest first: to choose the market codes to send it with.
 */
export function teamMarketsSeen(db: EngineDb): Array<CornerMarket & { seenAt: string; example: string }> {
  // Filtered on reading too, so markets noted before the filter existed (whole-match ones) drop out of the list.
  return marketsSeen(db, TEAM_MARKETS_KEY).filter(isTeamGoalsMarket);
}

/**
 * One team's own goals market ("Germany Over/Under 1.5 Goals", code TEAM_A_OVER_UNDER_15). Searching an event by the
 * team's name also returns its whole-match markets (Over/Under, First Half Goals...), which aren't the team's goals.
 */
export function isTeamGoalsMarket(m: { code: string | null }): boolean {
  return /^TEAM_[AB]_/.test(m.code ?? "");
}

function marketsSeen(db: EngineDb, key: string): Array<CornerMarket & { seenAt: string; example: string }> {
  try {
    const raw = db.getSetting(key);
    const map = raw ? (JSON.parse(raw) as Record<string, CornerMarket & { seenAt: string; example: string }>) : {};
    return Object.values(map).sort((a, b) => (a.seenAt < b.seenAt ? 1 : -1));
  } catch {
    return [];
  }
}

/**
 * A team's own goals market and its "Over <line>" selection, found by name (e.g. "Lens Over/Under 1.5 Goals" with
 * "Over 1.5 Goals"), so a favourite-to-score pick can be priced before its market codes are set.
 */
export function teamGoalsRunner<M extends { name: string; runners: Array<{ selectionId: number; runnerName: string }> }>(
  markets: M[],
  team: string,
  line: number,
): { market: M; selectionId: number } | null {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const t = words(team);
  const over = new RegExp(`\\bover\\s*${line.toFixed(1).replace(".", "\\.")}\\b`, "i");
  for (const m of markets) {
    const name = words(m.name);
    if (!name.includes(t) || !/over|under|goals/.test(name)) continue;
    const runner = m.runners.find((r) => over.test(r.runnerName));
    if (runner) return { market: m, selectionId: runner.selectionId };
  }
  return null;
}

/**
 * The first-half corners market and its "Over <line>" selection, found by name, so a First Half Corner Race pick can be
 * priced before its market code is set on the Sending page.
 */
export function firstHalfCornersRunner<M extends { name: string; runners: Array<{ selectionId: number; runnerName: string }> }>(
  markets: M[],
  line: number,
): { market: M; selectionId: number } | null {
  const over = new RegExp(`\\bover\\s*${line.toFixed(1).replace(".", "\\.")}\\b`, "i");
  for (const m of markets) {
    if (!/\b(1st|first)\s*half\b/i.test(m.name)) continue;
    const runner = m.runners.find((r) => over.test(r.runnerName));
    if (runner) return { market: m, selectionId: runner.selectionId };
  }
  return null;
}

function noteCornerMarkets(db: EngineDb, markets: CornerMarket[], example: string): void {
  noteMarkets(db, CORNER_MARKETS_KEY, markets, example);
}

function noteMarkets(db: EngineDb, key: string, markets: CornerMarket[], example: string): void {
  if (markets.length === 0) return;
  const map = Object.fromEntries(marketsSeen(db, key).map((m) => [m.code || m.name, m]));
  const now = new Date().toISOString();
  for (const m of markets) map[m.code || m.name] = { ...m, seenAt: now, example };
  db.setSetting(key, JSON.stringify(map));
}

type MatchCache = Map<string, { result: "on" | "nameDiffers" | "off"; event: string | null; eventId: string | null; at: number }>;

async function checkNewAlerts(db: EngineDb, reader: BetfairReader, cache: MatchCache): Promise<void> {
  const namer = exchangeNamer(db);
  const settings = getSendingSettings(db);
  const now = Date.now();
  for (const p of db.picksToCheckOnExchange(new Date(now - CHECK_WITHIN_MS).toISOString(), CHECKS_PER_POLL)) {
    if (!p.home || !p.away) {
      db.setPickExchange(p.id, "unknown", null);
      continue;
    }
    // Names as the exchange writes them (Match names on the Sending page), the same as the bet feed sends.
    const home = namer(p.home);
    const away = namer(p.away);
    const key = `${home}|${away}`.toLowerCase();
    let found = cache.get(key);
    if (!found || now - found.at > 30 * 60 * 1000) {
      const at = new Date(p.firstSeenAt);
      let judged = judgeExchange(home, away, await reader.searchEvents(searchWord(home), at));
      if (judged.result !== "on") {
        const byAway = judgeExchange(home, away, await reader.searchEvents(searchWord(away), at));
        if (byAway.result === "on" || (byAway.result === "nameDiffers" && judged.result === "off")) judged = byAway;
      }
      // One word can miss (Betfair's search is word-based and some names are abbreviated): try each full name too.
      for (const name of [home, away]) {
        if (judged.result !== "off") break;
        const byName = judgeExchange(home, away, await reader.searchEvents(name, at));
        if (byName.result !== "off") judged = byName;
      }
      found = { ...judged, at: now };
      cache.set(key, found);
    }
    // The price of the bet the feed would send, read now, so the pick can be priced even when the alert has none.
    let odds: number | null = null;
    let check: { status: MarketCheck; detail: string } | null = null;
    const pick = found.result === "on" && found.eventId ? db.getLivePick(p.id) : null;
    if (pick) {
      const market = feedMarket(pick, settings, namer);
      if (!("error" in market)) {
        const bet = await reader.checkBet(found.eventId!, market.marketType, market.selectionName).catch(() => null);
        if (bet) {
          odds = bet.price;
          check = {
            status: bet.status,
            detail:
              bet.status === "noMarket"
                ? `Betfair has no ${market.marketType} market for this match.`
                : bet.status === "noSelection"
                  ? `Betfair's ${market.marketType} market has no "${market.selectionName}"; it has ${bet.runners.map((r) => `"${r}"`).join(", ")}.`
                  : `${market.marketType} · ${market.selectionName}`,
          };
          if (bet.status !== "ok") log.warn(`Bet not on Betfair as sent (pick ${p.id}, ${home} v ${away}): ${check.detail}`);
        }
      }
    }
    db.setPickExchange(p.id, found.result, found.event, odds, check);
    // Favourite to score again ("Pass Master 1st half"): note the favourite's goal markets on offer (to choose the codes),
    // and if they aren't set yet, find the favourite's goals market by name to price the pick anyway.
    if (pick?.market === "FAVOURITE_TO_SCORE" && found.eventId && pick.detail?.favourite) {
      const team = namer(pick.detail.favourite === "home" ? (pick.home ?? "") : (pick.away ?? ""));
      const markets = team ? await reader.marketsNamed(found.eventId, team).catch(() => []) : [];
      noteMarkets(
        db,
        TEAM_MARKETS_KEY,
        markets.filter(isTeamGoalsMarket).map(({ name, code, selections }) => ({ name, code, selections })),
        `${found.event ?? `${home} v ${away}`} (favourite ${team})`,
      );
      const line = pick.detail.targetLine ?? null;
      const hit = odds === null && line !== null ? teamGoalsRunner(markets, team, line) : null;
      if (hit) {
        odds = await reader.priceOf(hit.market.marketId, hit.selectionId).catch(() => null);
        if (odds !== null) db.setPickExchange(p.id, found.result, found.event, odds, check);
      }
    }
    // First Half Corner Race: note the corner markets on offer (to choose its market code), and if its code isn't set
    // yet, find the first-half corners market by name to price the pick anyway.
    if (pick?.market === "FIRST_HALF_CORNERS" && found.eventId) {
      const markets = await reader.cornerMarkets(found.eventId).catch(() => []);
      noteCornerMarkets(
        db,
        markets.map(({ name, code, selections }) => ({ name, code, selections })),
        found.event ?? `${home} v ${away}`,
      );
      const line = pick.detail?.targetLine ?? null;
      const hit = odds === null && line !== null ? firstHalfCornersRunner(markets, line) : null;
      if (hit) {
        odds = await reader.priceOf(hit.market.marketId, hit.selectionId).catch(() => null);
        if (odds !== null) db.setPickExchange(p.id, found.result, found.event, odds);
      }
    }
    if (found.result === "off") log.info(`Not on Betfair: ${home} v ${away} (pick ${p.id}).`);
  }
}

// ---------------------------------------------------------------------------
// The poller

export interface BetfairLinkStatus {
  configured: boolean;
  /** Settings still needed, by name. */
  missing: string[];
  /** When Betfair last answered, and when the last attempt failed and why. */
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  /** Bets seen on the last good poll. */
  lastCount: number;
  /** When Betfair's list of competitions was last saved. */
  competitionsAt?: string | null;
}

const status: BetfairLinkStatus = { configured: false, missing: [], lastOkAt: null, lastErrorAt: null, lastError: null, lastCount: 0 };

export function getBetfairLinkStatus(): BetfairLinkStatus {
  return { ...status, missing: [...status.missing] };
}

/** Starts reading bets from Betfair every POLL_MS, if the settings are there. Returns a stop function. */
export function startBetfairPoller(db: EngineDb): () => void {
  const creds = readCredentials();
  status.missing = missingSettings();
  status.configured = creds !== null;
  if (!creds) {
    log.info(`Betfair bet check is off until these engine settings are added: ${status.missing.join(", ")}.`);
    return () => {};
  }
  const reader = new BetfairReader(creds);
  const exchangeCache: MatchCache = new Map();
  let running = false;
  let competitionsAt = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const bets = await reader.recentBets();
      db.saveBetfairBets(bets, new Date().toISOString());
      const linked = matchBets(db);
      if (linked > 0) log.info(`Betfair: ${linked} new bet(s) linked to picks.`);
      const corrected = db.markBetPicksOnExchange();
      if (corrected > 0) log.info(`Betfair: ${corrected} pick(s) marked on Betfair from their placed bets.`);
      status.lastOkAt = new Date().toISOString();
      status.lastCount = bets.length;
      // Picks still with no bet 3 minutes after sending: one push notification each (betfair/unplaced.ts).
      await notifyUnplaced(db, status.lastOkAt).catch((err: unknown) => log.warn(`Not-placed check failed: ${err instanceof Error ? err.message : String(err)}`));
      if (status.lastError) log.info("Betfair bet check is working again.");
      status.lastError = null;
      // Every few hours, save the competitions Betfair lists (for the Leagues page's Betfair coverage check).
      if (Date.now() - competitionsAt > COMPETITIONS_EVERY_MS) {
        competitionsAt = Date.now();
        await reader
          .footballCompetitions()
          .then((list) => {
            db.saveBetfairCompetitions(list, new Date().toISOString());
            status.competitionsAt = new Date().toISOString();
          })
          .catch((err: unknown) => log.warn(`Betfair competitions list failed: ${err instanceof Error ? err.message : String(err)}`));
      }
      // Then look up any new alerts' matches; a failure here leaves them to try again next time.
      await checkNewAlerts(db, reader, exchangeCache).catch((err: unknown) => {
        log.warn(`Betfair event lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Log a new problem once, not every 45 seconds.
      if (message !== status.lastError) log.warn(`Betfair bet check failed: ${message}`);
      status.lastError = message;
      status.lastErrorAt = new Date().toISOString();
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), POLL_MS);
  timer.unref();
  log.info("Betfair bet check started (read only, every 45 seconds).");
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Placement status per pick, for the Live page

/** How long after a pick is sent the betting software normally places it; past this with no bet, it's "not placed". */
/** The same 3 minutes as the "not placed" notification (betfair/unplaced.ts). */
const NOT_PLACED_AFTER_MS = UNPLACED_AFTER_MS;

export type PlacementState = "checking" | "beforeKickoff" | "waiting" | "matched" | "won" | "lost" | "lapsed" | "notPlaced" | "manual";

export interface Placement {
  state: PlacementState;
  /** Stake asked for and matched, average price matched, and profit once settled (all across the pick's bets). */
  stake: number | null;
  matched: number;
  odds: number | null;
  profit: number | null;
  bets: number;
  /** Logged on Live as placed by hand. */
  manual?: { stake: number; odds: number } | null;
}

/**
 * Where each pick sent in the last `hours` stands on Betfair: matched (and at what price), waiting to be matched,
 * settled, lapsed, or not placed at all. "Not placed" is only said once Betfair has been checked at least
 * NOT_PLACED_AFTER_MS after the pick was sent; until then it is "checking".
 */
export function pickPlacements(db: EngineDb, link: BetfairLinkStatus, now = new Date(), hours = 12): Record<number, Placement> {
  const since = now.getTime() - hours * 60 * 60 * 1000;
  const byPick = new Map<number, ReturnType<EngineDb["listBetfairBets"]>>();
  for (const b of db.listBetfairBets()) if (b.pickId !== null) (byPick.get(b.pickId) ?? byPick.set(b.pickId, []).get(b.pickId)!).push(b);
  const lastOk = link.lastOkAt ? Date.parse(link.lastOkAt) : null;
  const out: Record<number, Placement> = {};
  for (const p of db.listSentPicks()) {
    const sent = Date.parse(p.sentAt);
    if (sent < since) continue;
    const bets = byPick.get(p.id) ?? [];
    const matched = bets.reduce((n, b) => n + (b.matched ?? 0), 0);
    const odds = matched > 0 ? bets.reduce((n, b) => n + (b.matched ?? 0) * (b.odds ?? 0), 0) / matched : null;
    const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
    // A bet placed by hand (and nothing on Betfair for it): settled from the pick's own result.
    if (p.manualBet && bets.length === 0) {
      const result = db.getLivePick(p.id)?.result ?? null;
      const m = p.manualBet;
      out[p.id] = {
        state: result === "hit" ? "won" : result === "miss" ? "lost" : "manual",
        stake: m.stake,
        matched: m.stake,
        odds: m.odds,
        profit: result === "hit" ? Math.round(m.stake * (m.odds - 1) * 100) / 100 : result === "miss" ? -m.stake : null,
        bets: 0,
        manual: { stake: m.stake, odds: m.odds },
      };
      continue;
    }
    let state: PlacementState;
    if (settled.length > 0) state = settled.some((b) => b.status === "won") ? "won" : "lost";
    else if (matched > 0) state = "matched";
    else if (bets.some((b) => b.status === "pending")) state = "waiting";
    else if (bets.length > 0) state = "lapsed";
    else {
      // The betting software bets as soon as it reads a pick, pre-match ones included (its betting window opens before
      // the alert arrives), so no bet 3 minutes on means it turned the pick down. A pre-match pick stays in the feed
      // until kick-off, so it can still be placed later, and then shows as placed.
      state = lastOk !== null && lastOk >= sent + NOT_PLACED_AFTER_MS ? "notPlaced" : "checking";
    }
    out[p.id] = {
      state,
      stake: bets.reduce<number | null>((n, b) => (b.stake === null ? n : (n ?? 0) + b.stake), null),
      matched: Math.round(matched * 100) / 100,
      odds: odds === null ? null : Math.round(odds * 100) / 100,
      profit: settled.length > 0 ? Math.round(bets.reduce((n, b) => n + (b.profit ?? 0), 0) * 100) / 100 : null,
      bets: bets.length,
    };
  }
  return out;
}
