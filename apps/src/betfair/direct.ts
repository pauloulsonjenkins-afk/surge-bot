/**
 * Direct betting: GoalBrew places the bets on Betfair itself, instead of handing them to BF Bot Manager through the
 * bet feed. Built to replace the betting software and the VPS once it has proved itself, so it has three modes:
 *
 *   off     (the default) nothing happens.
 *   shadow  BF Bot Manager keeps betting from the feed as now. For each pick the feed hands over, this module does
 *           everything it would do to place the bet (finds the market, reads the price, runs its checks) and records
 *           "would back £2 at 1.85" or why it wouldn't, but never places anything. Compare it with what BF Bot
 *           Manager actually got before going live.
 *   live    this module takes the feed's place: it runs the same feed rules (master and strategy switches, stake,
 *           minimum odds, stop loss, daily limit, age, the Betfair match check; see buildFeed), and places each new
 *           pick on Betfair itself. The CSV feed then hands BF Bot Manager nothing new, so a pick can't be bet twice.
 *
 * SAFETY
 *   - Live needs two keys: the engine setting BF_DIRECT_BETTING=allow (set in DigitalOcean, out of reach of the
 *     website) and the Live choice on the Direct betting page. Without the engine setting, Live acts as Shadow.
 *   - One record per pick (direct_bets, pick_id is the key): a pick is looked at once and placed at most once. Only
 *     picks handed over after the mode was last changed are taken, so switching to Live never bets a pick that the
 *     feed already gave BF Bot Manager.
 *   - Each order carries the pick's own reference (customerOrderRef "GB<pick id>"). Before placing, Betfair is asked
 *     whether an order with that reference already exists, and if an answer is lost (a timeout) the record stays
 *     "placing" until Betfair's order list says either way. It is never simply sent again.
 *   - The same checks BF Bot Manager runs: the minimum odds, the gap between the back and lay prices, and the
 *     market's overround, with per-strategy limits. A pick that fails one waits and is checked again until it is
 *     too old to bet.
 *   - A daily limit on the total staked directly, on top of the feed's own daily limit and stake ceiling.
 *   - Each bet asks for the lowest price accepted (a set % under the price shown, never under the minimum odds) and
 *     Betfair matches it at the best price really on offer, so slightly old prices (the delayed app key) still match.
 *   - Any stake still unmatched after a set time is cancelled (only bets this module placed).
 *   - Switching away from Live stops any pick still waiting from being placed.
 */
import type { CurrentOrder } from "./exchange";
import { findRunner, getBetfairLinkStatus, post, readCredentials } from "./exchange";
import type { DirectBet, EngineDb, LivePick } from "../storage/engine-db";
import { betableUntil, buildFeed, EXCHANGE_HOLD_MS, getSendingSettings, strategyLabel, type FeedRow } from "../inplayguru/bet-feed";
import { saveBank } from "../inplayguru/stake";
import { ukDateOf, ukDayBounds } from "../server/uk-time";
import { log } from "../server/log";
import { excelTime, toExcelCsv } from "../server/excel";

// ---------------------------------------------------------------------------
// Settings

export type DirectMode = "off" | "shadow" | "live";
/** What happens to alerts that arrive by InPlayGuru's webhook: kept only (as now), or used as picks like Telegram's. */
export type WebhookUse = "record" | "use";

export interface StrategyLimits {
  /** Largest gap allowed between the best lay and best back price, as a percentage of the back price. */
  maxSpreadPct?: number;
  /** Highest overround allowed (percent). */
  maxOverround?: number;
}

export interface DirectSettings {
  mode: DirectMode;
  /** When the mode was last changed: only picks handed over from then on are taken. */
  since: string;
  maxSpreadPct: number;
  minOverround: number;
  maxOverround: number;
  /** Per strategy (lower-case name), overriding the two limits above. */
  strategyLimits: Record<string, StrategyLimits>;
  /** Unmatched stake is cancelled after this long. */
  cancelUnmatchedSeconds: number;
  /** Most staked directly per UK day, in pounds. */
  dailyStakeLimit: number;
  /**
   * How far below the price shown a bet may be matched, in percent (never below the strategy's minimum odds). The bet
   * asks for that lowest price and Betfair matches it at the best price really on offer, so prices that are a little
   * old (Betfair's delayed app key) don't stop it matching. 0 = ask for exactly the price shown.
   */
  acceptBelowPct: number;
  webhook: WebhookUse;
}

const SETTINGS_KEY = "direct_betting";

export const DEFAULT_DIRECT: DirectSettings = {
  mode: "off",
  since: new Date(0).toISOString(),
  // The same as BF Bot Manager's settings on 3 Oct 2026: back/lay within 15%, overround 95% to 130%.
  maxSpreadPct: 15,
  minOverround: 95,
  maxOverround: 130,
  strategyLimits: {
    "time to fight": { maxOverround: 140 },
    "losing team pushing hard": { maxSpreadPct: 25 },
  },
  cancelUnmatchedSeconds: 120,
  dailyStakeLimit: 50,
  acceptBelowPct: 5,
  webhook: "record",
};

/** Betfair's smallest back stake in pounds. */
const MIN_STAKE = 1;

/** Whether the engine allows Live (the BF_DIRECT_BETTING=allow setting in DigitalOcean). */
export function liveAllowed(env = process.env): boolean {
  return env.BF_DIRECT_BETTING?.trim().toLowerCase() === "allow";
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : fallback;
}

function limitsOf(v: unknown): Record<string, StrategyLimits> {
  const out: Record<string, StrategyLimits> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const l: StrategyLimits = {};
    const spread = num(r.maxSpreadPct, 1, 100, NaN);
    const over = num(r.maxOverround, 100, 300, NaN);
    if (Number.isFinite(spread)) l.maxSpreadPct = spread;
    if (Number.isFinite(over)) l.maxOverround = over;
    if (l.maxSpreadPct !== undefined || l.maxOverround !== undefined) out[strategyLabel(k).toLowerCase()] = l;
  }
  return out;
}

export function getDirectSettings(db: EngineDb): DirectSettings {
  let raw: Record<string, unknown> = {};
  try {
    const saved = db.getSetting(SETTINGS_KEY);
    if (saved) raw = JSON.parse(saved) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const d = DEFAULT_DIRECT;
  const minOverround = num(raw.minOverround, 50, 110, d.minOverround);
  return {
    mode: raw.mode === "shadow" || raw.mode === "live" ? raw.mode : "off",
    since: typeof raw.since === "string" && Number.isFinite(Date.parse(raw.since)) ? raw.since : d.since,
    maxSpreadPct: num(raw.maxSpreadPct, 1, 100, d.maxSpreadPct),
    minOverround,
    maxOverround: Math.max(minOverround, num(raw.maxOverround, 100, 300, d.maxOverround)),
    strategyLimits: raw.strategyLimits === undefined ? { ...d.strategyLimits } : limitsOf(raw.strategyLimits),
    cancelUnmatchedSeconds: num(raw.cancelUnmatchedSeconds, 10, 1800, d.cancelUnmatchedSeconds),
    dailyStakeLimit: num(raw.dailyStakeLimit, 1, 5000, d.dailyStakeLimit),
    acceptBelowPct: num(raw.acceptBelowPct, 0, 20, d.acceptBelowPct),
    webhook: raw.webhook === "use" ? "use" : "record",
  };
}

/**
 * Saves the admin's changes (any subset of the fields). Throws with a reason for the admin, e.g. Live while the engine
 * doesn't allow it. A change of mode restarts `since`, so only picks handed over from now on are taken.
 */
export function saveDirectSettings(db: EngineDb, body: Record<string, unknown>, now = new Date(), env = process.env): DirectSettings {
  const before = getDirectSettings(db);
  const merged: Record<string, unknown> = { ...before };
  for (const k of ["mode", "maxSpreadPct", "minOverround", "maxOverround", "strategyLimits", "cancelUnmatchedSeconds", "dailyStakeLimit", "acceptBelowPct", "webhook"] as const) {
    if (body[k] !== undefined) merged[k] = body[k];
  }
  if (body.mode !== undefined && body.mode !== "off" && body.mode !== "shadow" && body.mode !== "live") throw new Error("Mode must be off, shadow or live.");
  if (merged.mode !== "off" && readCredentials(env) === null) throw new Error("The Betfair link isn't set up on the engine yet (BF_APP_KEY and the login settings).");
  if (merged.mode === "live" && before.mode !== "live" && !liveAllowed(env)) {
    throw new Error("Live is locked on the engine. Add the setting BF_DIRECT_BETTING = allow to the engine in DigitalOcean first.");
  }
  if (merged.mode !== before.mode) merged.since = now.toISOString();
  db.setSetting(SETTINGS_KEY, JSON.stringify(merged));
  const after = getDirectSettings(db);
  if (after.mode !== before.mode) log.info(`Direct betting switched from ${before.mode} to ${after.mode} from the admin page.`);
  if (after.webhook !== before.webhook) log.info(`Webhook alerts now ${after.webhook === "use" ? "used as picks" : "recorded only"}.`);
  wake();
  return after;
}

/** The mode in force: Live only when the engine allows it, otherwise Shadow. */
export function effectiveMode(s: DirectSettings, env = process.env): DirectMode {
  return s.mode === "live" && !liveAllowed(env) ? "shadow" : s.mode;
}

/** True when GoalBrew places bets itself, so the CSV feed must hand BF Bot Manager nothing new. */
export function directIsLive(db: EngineDb, env = process.env): boolean {
  return effectiveMode(getDirectSettings(db), env) === "live" && readCredentials(env) !== null;
}

// ---------------------------------------------------------------------------
// Betfair, for placing

export interface BookRunner {
  selectionId: number;
  status: string;
  back: number | null;
  lay: number | null;
}
export interface Book {
  status: string;
  inplay: boolean;
  runners: BookRunner[];
}
export type PlaceResult = { ok: true; betId: string; sizeMatched: number; avgPrice: number | null } | { ok: false; code: string };
export type RefOrder = CurrentOrder & { customerOrderRef?: string };

/** What direct betting needs from Betfair. The real one is BetfairTrader; tests pass a fake. */
export interface Trading {
  market(eventId: string, marketType: string): Promise<{ marketId: string; runners: Array<{ selectionId: number; runnerName: string }> } | null>;
  book(marketId: string): Promise<Book | null>;
  ordersByRef(refs: string[]): Promise<RefOrder[]>;
  ordersById(betIds: string[]): Promise<RefOrder[]>;
  place(o: { marketId: string; selectionId: number; price: number; size: number; ref: string; attempt: number }): Promise<PlaceResult>;
  cancel(marketId: string, betId: string): Promise<number>;
}

const LOGIN_URL = "https://identitysso-cert.betfair.com/api/certlogin";
const BETTING_URL = "https://api.betfair.com/exchange/betting/rest/v1.0/";
const ACCOUNT_URL = "https://api.betfair.com/exchange/account/rest/v1.0/";
const SESSION_MS = 3 * 60 * 60 * 1000;

type Creds = NonNullable<ReturnType<typeof readCredentials>>;

/** Betfair's API with its own login, kept apart from the read-only poller in exchange.ts. */
export class BetfairTrader implements Trading {
  private session: { token: string; at: number } | null = null;

  constructor(private readonly creds: Creds) {}

  private async login(): Promise<string> {
    const body = new URLSearchParams({ username: this.creds.username, password: this.creds.password }).toString();
    const res = await post(LOGIN_URL, body, { "X-Application": this.creds.appKey, "Content-Type": "application/x-www-form-urlencoded" }, { cert: this.creds.cert, key: this.creds.key });
    let parsed: { sessionToken?: string; loginStatus?: string } = {};
    try {
      parsed = JSON.parse(res.text) as typeof parsed;
    } catch {
      throw new Error(`Betfair login failed (HTTP ${res.status}).`);
    }
    if (parsed.loginStatus !== "SUCCESS" || !parsed.sessionToken) throw new Error(`Betfair login refused: ${parsed.loginStatus ?? `HTTP ${res.status}`}.`);
    this.session = { token: parsed.sessionToken, at: Date.now() };
    return parsed.sessionToken;
  }

  private async call<T>(url: string, operation: string, params: unknown, retried = false): Promise<T> {
    const token = this.session && Date.now() - this.session.at < SESSION_MS ? this.session.token : await this.login();
    const res = await post(`${url}${operation}/`, JSON.stringify(params), {
      "X-Application": this.creds.appKey,
      "X-Authentication": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    if (res.status === 200) return JSON.parse(res.text) as T;
    if (!retried && /INVALID_SESSION|NO_SESSION/.test(res.text)) {
      this.session = null;
      return this.call<T>(url, operation, params, true);
    }
    const code = /"errorCode"\s*:\s*"([A-Z_]+)"/.exec(res.text)?.[1];
    throw new Error(`Betfair ${operation} failed: ${code ?? `HTTP ${res.status}`}.`);
  }

  async market(eventId: string, marketType: string) {
    const list = await this.call<Array<{ marketId: string; runners?: Array<{ selectionId: number; runnerName: string }> }>>(BETTING_URL, "listMarketCatalogue", {
      filter: { eventIds: [eventId], marketTypeCodes: [marketType] },
      marketProjection: ["RUNNER_DESCRIPTION"],
      maxResults: 5,
    });
    const m = list[0];
    return m ? { marketId: m.marketId, runners: m.runners ?? [] } : null;
  }

  async book(marketId: string): Promise<Book | null> {
    const books = await this.call<
      Array<{ status?: string; inplay?: boolean; runners?: Array<{ selectionId: number; status?: string; ex?: { availableToBack?: Array<{ price: number }>; availableToLay?: Array<{ price: number }> } }> }>
    >(BETTING_URL, "listMarketBook", { marketIds: [marketId], priceProjection: { priceData: ["EX_BEST_OFFERS"] } });
    const b = books[0];
    if (!b) return null;
    return {
      status: b.status ?? "UNKNOWN",
      inplay: b.inplay === true,
      runners: (b.runners ?? []).map((r) => ({
        selectionId: r.selectionId,
        status: r.status ?? "ACTIVE",
        back: r.ex?.availableToBack?.[0]?.price ?? null,
        lay: r.ex?.availableToLay?.[0]?.price ?? null,
      })),
    };
  }

  async ordersByRef(refs: string[]): Promise<RefOrder[]> {
    const r = await this.call<{ currentOrders: RefOrder[] }>(BETTING_URL, "listCurrentOrders", { customerOrderRefs: refs, orderProjection: "ALL" });
    return r.currentOrders;
  }

  async ordersById(betIds: string[]): Promise<RefOrder[]> {
    const r = await this.call<{ currentOrders: RefOrder[] }>(BETTING_URL, "listCurrentOrders", { betIds, orderProjection: "ALL" });
    return r.currentOrders;
  }

  async place(o: { marketId: string; selectionId: number; price: number; size: number; ref: string; attempt: number }): Promise<PlaceResult> {
    const r = await this.call<{
      status: string;
      errorCode?: string;
      instructionReports?: Array<{ status: string; errorCode?: string; betId?: string; sizeMatched?: number; averagePriceMatched?: number }>;
    }>(BETTING_URL, "placeOrders", {
      marketId: o.marketId,
      // customerRef de-duplicates a re-submission of the same request (Betfair keeps it for 60 seconds);
      // customerOrderRef stays the same for the pick, so the order can always be found by it.
      customerRef: `${o.ref}-${o.attempt}`,
      customerStrategyRef: "GoalBrew",
      instructions: [
        {
          selectionId: o.selectionId,
          handicap: 0,
          side: "BACK",
          orderType: "LIMIT",
          limitOrder: { size: o.size, price: o.price, persistenceType: "LAPSE" },
          customerOrderRef: o.ref,
        },
      ],
    });
    const rep = r.instructionReports?.[0];
    if (r.status === "SUCCESS" && rep?.betId) return { ok: true, betId: rep.betId, sizeMatched: rep.sizeMatched ?? 0, avgPrice: rep.averagePriceMatched ?? null };
    return { ok: false, code: rep?.errorCode ?? r.errorCode ?? r.status };
  }

  async cancel(marketId: string, betId: string): Promise<number> {
    const r = await this.call<{ instructionReports?: Array<{ sizeCancelled?: number }> }>(BETTING_URL, "cancelOrders", { marketId, instructions: [{ betId }] });
    return r.instructionReports?.[0]?.sizeCancelled ?? 0;
  }

  /** Money in the account, and whether the app key gives delayed prices. Read only. */
  async account(): Promise<{ available: number | null; exposure: number | null; delayedKey: boolean | null }> {
    const funds = await this.call<{ availableToBetBalance?: number; exposure?: number }>(ACCOUNT_URL, "getAccountFunds", {});
    let delayedKey: boolean | null = null;
    try {
      const apps = await this.call<Array<{ appVersions?: Array<{ applicationKey?: string; delayData?: boolean }> }>>(ACCOUNT_URL, "getDeveloperAppKeys", {});
      for (const a of apps) for (const v of a.appVersions ?? []) if (v.applicationKey === this.creds.appKey) delayedKey = v.delayData === true;
    } catch {
      delayedKey = null;
    }
    return { available: funds.availableToBetBalance ?? null, exposure: funds.exposure ?? null, delayedKey };
  }
}

// ---------------------------------------------------------------------------
// The work

/** The reference every order for a pick carries. Betfair allows letters, digits and a few symbols, 32 at most. */
export function orderRef(pickId: number): string {
  return `GB${pickId}`;
}

/** Overround of a market in percent: the sum of 1 / best back price. Double Chance covers each result twice, so it is halved. */
export function overroundOf(book: Book, marketType: string): number | null {
  const active = book.runners.filter((r) => r.status === "ACTIVE");
  if (active.length < 2 || active.some((r) => r.back === null || r.back <= 1)) return null;
  const sum = active.reduce((t, r) => t + 100 / (r.back as number), 0);
  return Math.round((/DOUBLE_CHANCE/i.test(marketType) ? sum / 2 : sum) * 10) / 10;
}

/** Betfair's price steps: up to each price, the step between prices. */
const LADDER: Array<[number, number]> = [[2, 0.01], [3, 0.02], [4, 0.05], [6, 0.1], [10, 0.2], [20, 0.5], [30, 1], [50, 2], [100, 5], [1000, 10]];

/** The lowest price Betfair accepts that is at least `price` (rounded up to the next step). */
export function tickAtOrAbove(price: number): number {
  if (price <= 1.01) return 1.01;
  let from = 1;
  for (const [upTo, step] of LADDER) {
    if (price <= upTo + 1e-9) {
      const n = Math.ceil((price - from) / step - 1e-9);
      return Math.round((from + n * step) * 100) / 100;
    }
    from = upTo;
  }
  return 1000;
}

/**
 * The price a back bet asks for: `acceptBelowPct` under the price shown, never under the minimum odds, on Betfair's
 * price steps, and never above the price shown.
 */
export function askPrice(shown: number, minPrice: number | null, acceptBelowPct: number): number {
  const floor = Math.max(minPrice ?? 1.01, shown * (1 - acceptBelowPct / 100));
  return Math.min(shown, tickAtOrAbove(floor));
}

/** Gap between best lay and best back, as a percentage of the back price. */
export function spreadPct(back: number, lay: number | null): number | null {
  return lay === null ? null : Math.round(((lay - back) / back) * 1000) / 10;
}

export const FRIENDLY: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Not enough money in the Betfair account.",
  INVALID_BET_SIZE: "Betfair won't take this stake size.",
  INVALID_ODDS: "The price isn't one Betfair accepts.",
  PERMISSION_DENIED: "The Betfair account or app key isn't allowed to place bets.",
  ACCESS_DENIED: "The Betfair account or app key isn't allowed to place bets.",
  ACCOUNT_STATUS_ERROR: "The Betfair account can't bet right now (check it on Betfair).",
  MARKET_NOT_OPEN_FOR_BETTING: "The market has closed.",
  RUNNER_REMOVED: "The selection has been removed from the market.",
  LOSS_LIMIT_EXCEEDED: "Your Betfair loss limit has been reached.",
  BET_ACTION_ERROR: "Betfair refused the bet.",
};
/** Refusals worth trying again while the pick is still fresh: the market was suspended (a goal, a card) or the price went. */
export const RETRY = new Set(["MARKET_SUSPENDED", "BET_TAKEN_OR_LAPSED", "BET_LAPSED_PRICE_IMPROVEMENT_TOO_LARGE", "ERROR_IN_MATCHER", "SERVICE_UNAVAILABLE", "TIMEOUT"]);

function money(n: number): string {
  return `£${n.toFixed(2)}`;
}

let running = false;
let again = false;
let trader: Trading | null = null;

/** The Betfair balance behind percentage stakes (stake.ts): read at most every 2 minutes, only when a strategy uses one. */
let lastBankRead = 0;
const BANK_EVERY_MS = 2 * 60_000;
async function refreshBank(db: EngineDb, trading: Trading, now: Date): Promise<void> {
  if (!(trading instanceof BetfairTrader)) return;
  const s = getSendingSettings(db);
  if (Object.keys(s.stakePct).length === 0) return;
  if (now.getTime() - lastBankRead < BANK_EVERY_MS) return;
  lastBankRead = now.getTime();
  try {
    const a = await trading.account();
    saveBank(db, { available: a.available, exposure: a.exposure }, now);
  } catch (err) {
    log.warn(`Betfair balance not read: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * One pass: in Live, run the feed rules to hand over new picks (to this module instead of BF Bot Manager); take new
 * picks; then work on every open record. Returns once done. Safe to call often: passes never overlap.
 */
export async function runDirect(db: EngineDb, trading: Trading, now = new Date(), env = process.env): Promise<void> {
  await refreshBank(db, trading, now);
  const settings = getDirectSettings(db);
  const mode = effectiveMode(settings, env);

  if (mode === "live") {
    const feed = buildFeed(db, { markSent: true, now, holdForExchangeMs: getBetfairLinkStatus().configured ? EXCHANGE_HOLD_MS : 0 });
    if (feed.newlySent > 0) log.info(`Direct betting: ${feed.newlySent} new pick(s) to place.`);
  }

  const sending = getSendingSettings(db);
  if (mode !== "off") {
    for (const p of db.listLivePicks(200)) {
      if (!p.sentAt || p.sentAt < settings.since || !p.sentRowJson) continue;
      if (now.getTime() > betableUntil(p, sending.maxAgeMinutes)) continue;
      let row: FeedRow;
      try {
        row = JSON.parse(p.sentRowJson) as FeedRow;
      } catch {
        continue;
      }
      if (typeof row.stake !== "number" || !row.marketType || !row.selectionName) continue;
      db.claimDirectBet(
        p.id,
        mode,
        { strategy: strategyLabel(p.strategy), eventName: p.exchangeEvent ?? row.eventName, marketType: row.marketType, selectionName: row.selectionName, stake: row.stake, minPrice: row.minPrice ?? null },
        now.toISOString(),
      );
    }
  }

  for (const d of db.listOpenDirectBets()) {
    try {
      await work(db, trading, d, settings, mode, sending.maxAgeMinutes, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Direct betting, pick ${d.pickId}: ${message}`);
      // A record being placed stays "placing": its outcome is read from Betfair next time, never guessed.
      if (d.state === "waiting") db.updateDirectBet(d.pickId, { reason: message }, now.toISOString());
    }
  }
}

async function work(db: EngineDb, t: Trading, d: DirectBet, s: DirectSettings, mode: DirectMode, maxAgeMinutes: number, now: Date): Promise<void> {
  const at = now.toISOString();
  const ref = orderRef(d.pickId);

  // Sent, answer unknown: Betfair's order list says whether it was placed. Never sent again blindly.
  if (d.state === "placing") {
    const found = (await t.ordersByRef([ref]))[0];
    if (found) {
      db.updateDirectBet(d.pickId, { state: "placed", betId: found.betId, sizeMatched: found.sizeMatched ?? 0, avgPrice: found.averagePriceMatched ?? null, reason: null }, at);
    } else if (d.attempts >= 3) {
      db.updateDirectBet(d.pickId, { state: "failed", reason: "Betfair didn't confirm the bet and has no order for it." }, at);
    } else {
      db.updateDirectBet(d.pickId, { attempts: d.attempts + 1 }, at);
    }
    return;
  }

  // Placed with some stake not matched yet: keep the figures up to date, and cancel what's left after the set time.
  if (d.state === "placed") {
    if (!d.betId) return;
    const o = (await t.ordersById([d.betId]))[0];
    const matched = o?.sizeMatched ?? d.sizeMatched ?? 0;
    const remaining = o ? (o.sizeRemaining ?? 0) : 0;
    if (!o || remaining <= 0 || o.status === "EXECUTION_COMPLETE") {
      // Fully matched, or the rest lapsed (a goal suspends the market) or was cancelled: nothing left open.
      db.updateDirectBet(d.pickId, { sizeMatched: matched, avgPrice: o?.averagePriceMatched ?? d.avgPrice, cancelled: Math.max(0, d.stake - matched) }, at);
      return;
    }
    if (now.getTime() - Date.parse(d.createdAt) >= s.cancelUnmatchedSeconds * 1000 && d.marketId) {
      const cancelled = await t.cancel(d.marketId, d.betId);
      db.updateDirectBet(
        d.pickId,
        { sizeMatched: matched, avgPrice: o.averagePriceMatched ?? d.avgPrice, cancelled: Math.max(cancelled, d.stake - matched), reason: `${money(remaining)} not matched within ${s.cancelUnmatchedSeconds} s, so cancelled.` },
        at,
      );
    } else {
      db.updateDirectBet(d.pickId, { sizeMatched: matched, avgPrice: o.averagePriceMatched ?? d.avgPrice }, at);
    }
    return;
  }

  // Waiting. A Live record stops here when Live has been switched off since.
  if (d.mode === "live" && mode !== "live") {
    db.updateDirectBet(d.pickId, { state: "skipped", reason: "Direct betting left Live before it was placed." }, at);
    return;
  }
  if (d.mode === "shadow" && mode === "off") {
    db.updateDirectBet(d.pickId, { state: "skipped", reason: "Direct betting was switched off." }, at);
    return;
  }
  const p: LivePick | null = db.getLivePick(d.pickId);
  if (!p || p.excluded) {
    db.updateDirectBet(d.pickId, { state: "skipped", reason: "The pick was removed." }, at);
    return;
  }
  if (now.getTime() > betableUntil(p, maxAgeMinutes)) {
    db.updateDirectBet(d.pickId, { state: "skipped", reason: `Too old to bet. ${d.reason ?? ""}`.trim() }, at);
    return;
  }
  const wait = (reason: string) => db.updateDirectBet(d.pickId, { reason }, at);
  const fail = (reason: string) => db.updateDirectBet(d.pickId, { state: "failed", reason }, at);

  if (d.stake < MIN_STAKE) return fail(`Betfair's smallest stake is ${money(MIN_STAKE)}.`);
  if (!p.exchangeEventId) {
    if (p.exchange === "off") return fail("The match wasn't found on Betfair.");
    return wait("Finding the match on Betfair.");
  }

  let marketId = d.marketId;
  let selectionId = d.selectionId;
  if (!marketId || selectionId === null) {
    const m = await t.market(p.exchangeEventId, d.marketType);
    if (!m) return fail(`Betfair has no ${d.marketType} market for this match.`);
    const runner = findRunner(m.runners, d.selectionName);
    if (!runner) return fail(`No selection called "${d.selectionName}" in that market (it has: ${m.runners.map((r) => r.runnerName).join(", ")}).`);
    marketId = m.marketId;
    selectionId = runner.selectionId;
    db.updateDirectBet(d.pickId, { marketId, selectionId }, at);
  }

  const book = await t.book(marketId);
  if (!book) return wait("No prices from Betfair yet.");
  if (book.status === "CLOSED") return fail("The market has closed.");
  if (book.status !== "OPEN") return wait("The market is suspended.");
  const me = book.runners.find((r) => r.selectionId === selectionId);
  if (!me || me.status !== "ACTIVE") return fail("The selection is no longer in the market.");
  if (me.back === null) return wait("Nothing on offer to back yet.");

  const limits = s.strategyLimits[d.strategy.toLowerCase()] ?? {};
  const maxSpread = limits.maxSpreadPct ?? s.maxSpreadPct;
  const maxOver = limits.maxOverround ?? s.maxOverround;
  const spread = spreadPct(me.back, me.lay);
  const over = overroundOf(book, d.marketType);
  db.updateDirectBet(d.pickId, { price: me.back, bestLay: me.lay, overround: over }, at);

  if (d.minPrice !== null && me.back < d.minPrice) return wait(`Price ${me.back.toFixed(2)} is below the minimum ${d.minPrice.toFixed(2)}.`);
  if (spread === null) return wait("Nothing on offer to lay, so the price gap can't be checked.");
  if (spread > maxSpread) return wait(`Back ${me.back.toFixed(2)} and lay ${me.lay!.toFixed(2)} are ${spread}% apart (limit ${maxSpread}%).`);
  if (over === null) return wait("Not every selection has a price, so the overround can't be checked.");
  if (over < s.minOverround || over > maxOver) return wait(`Overround ${over}% is outside ${s.minOverround}% to ${maxOver}%.`);

  // The price asked for: the lowest accepted. Betfair matches it at the best price on offer, which is at least this.
  const ask = askPrice(me.back, d.minPrice, s.acceptBelowPct);
  const taking = ask < me.back ? ` (taking down to ${ask.toFixed(2)})` : "";

  if (d.mode === "shadow") {
    db.updateDirectBet(d.pickId, { state: "shadow", askPrice: ask, reason: `Would back ${money(d.stake)} at ${me.back.toFixed(2)}${taking}.` }, at);
    return;
  }

  // Live from here.
  const dayStart = ukDayBounds(ukDateOf(now)).from;
  const staked = db.directStakeSince(dayStart);
  if (staked + d.stake > s.dailyStakeLimit + 1e-9) {
    db.updateDirectBet(d.pickId, { state: "skipped", reason: `Daily stake limit reached (${money(staked)} of ${money(s.dailyStakeLimit)} placed today).` }, at);
    return;
  }
  const existing = (await t.ordersByRef([ref]))[0];
  if (existing) {
    db.updateDirectBet(d.pickId, { state: "placed", betId: existing.betId, sizeMatched: existing.sizeMatched ?? 0, avgPrice: existing.averagePriceMatched ?? null, reason: null }, at);
    return;
  }
  const attempt = d.attempts + 1;
  db.updateDirectBet(d.pickId, { state: "placing", attempts: attempt, price: me.back, askPrice: ask }, at);
  let result: PlaceResult;
  try {
    result = await t.place({ marketId, selectionId, price: ask, size: d.stake, ref, attempt });
  } catch (err) {
    // No answer: it may or may not have been placed. The next pass asks Betfair by the reference.
    db.updateDirectBet(d.pickId, { attempts: 0, reason: `No answer from Betfair (${err instanceof Error ? err.message : String(err)}); checking.` }, at);
    return;
  }
  if (result.ok) {
    db.updateDirectBet(d.pickId, { state: "placed", betId: result.betId, sizeMatched: result.sizeMatched, avgPrice: result.avgPrice, reason: null }, at);
    log.info(`Direct betting: pick ${d.pickId} placed, ${money(d.stake)} asking ${ask.toFixed(2)} (shown ${me.back.toFixed(2)}; bet ${result.betId}, ${money(result.sizeMatched)} matched).`);
    return;
  }
  if (RETRY.has(result.code)) {
    db.updateDirectBet(d.pickId, { state: "waiting", reason: `Betfair said ${result.code}; trying again.` }, at);
    return;
  }
  db.updateDirectBet(d.pickId, { state: "failed", reason: FRIENDLY[result.code] ?? `Betfair refused the bet (${result.code}).` }, at);
  log.warn(`Direct betting: pick ${d.pickId} refused by Betfair: ${result.code}.`);
}

// ---------------------------------------------------------------------------
// Running it, and its status for the admin page

let wakeNow: (() => void) | null = null;

/** Runs a pass straight away (a new alert, a match found on Betfair, a settings change). */
export function wake(): void {
  wakeNow?.();
}

const PASS_MS = 4_000;

/** Starts direct betting's passes, if the Betfair link is set up. Returns a stop function. */
export function startDirectBetting(db: EngineDb): () => void {
  const creds = readCredentials();
  if (!creds) return () => {};
  trader = new BetfairTrader(creds);
  const pass = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        // Percentage stakes (stake.ts) need the balance even while direct betting is off (for simulation).
        await refreshBank(db, trader!, new Date());
        if (getDirectSettings(db).mode === "off" && db.listOpenDirectBets().length === 0) break;
        await runDirect(db, trader!).catch((err: unknown) => log.warn(`Direct betting pass failed: ${err instanceof Error ? err.message : String(err)}`));
      } while (again);
    } finally {
      running = false;
    }
  };
  wakeNow = () => void pass();
  const timer = setInterval(() => void pass(), PASS_MS);
  timer.unref();
  const s = getDirectSettings(db);
  log.info(`Direct betting ready: ${s.mode}${s.mode === "live" && !liveAllowed() ? " (acts as shadow: BF_DIRECT_BETTING isn't set to allow)" : ""}.`);
  return () => {
    clearInterval(timer);
    wakeNow = null;
  };
}

export interface DirectReadiness {
  betfairLinked: boolean;
  liveAllowed: boolean;
  loginOk: boolean | null;
  error: string | null;
  available: number | null;
  exposure: number | null;
  delayedKey: boolean | null;
  checkedAt: string | null;
}

let readinessCache: { at: number; value: DirectReadiness } | null = null;
let readinessChecking: Promise<void> | null = null;

/**
 * What the Direct betting page shows before going Live. Betfair is asked at most once a minute, and the page never
 * waits long for it: after 3 seconds it gets the last answer (or "not checked yet") and the next refresh has the new one.
 */
export async function directReadiness(env = process.env): Promise<DirectReadiness> {
  const linked = readCredentials(env) !== null;
  const base: DirectReadiness = { betfairLinked: linked, liveAllowed: liveAllowed(env), loginOk: null, error: null, available: null, exposure: null, delayedKey: null, checkedAt: null };
  if (!linked || !(trader instanceof BetfairTrader)) return base;
  const t = trader;
  if (!readinessCache || Date.now() - readinessCache.at >= 60_000) {
    readinessChecking ??= (async () => {
      const value = { ...base };
      try {
        const a = await t.account();
        value.loginOk = true;
        value.available = a.available;
        value.exposure = a.exposure;
        value.delayedKey = a.delayedKey;
      } catch (err) {
        value.loginOk = false;
        value.error = err instanceof Error ? err.message : String(err);
      }
      value.checkedAt = new Date().toISOString();
      readinessCache = { at: Date.now(), value };
    })().finally(() => {
      readinessChecking = null;
    });
    await Promise.race([readinessChecking, new Promise((r) => setTimeout(r, 3000))]);
  }
  return readinessCache ? { ...readinessCache.value, betfairLinked: linked, liveAllowed: liveAllowed(env) } : base;
}

/** Money staked directly today, for the page. */
export function stakedToday(db: EngineDb, now = new Date()): number {
  return db.directStakeSince(ukDayBounds(ukDateOf(now)).from);
}

// ---------------------------------------------------------------------------
// The Excel download (Direct betting page): every record, one row each

/**
 * Who actually got a bet matched on the pick: GoalBrew (its own bet), BF Bot Manager (any other bet on Betfair linked to
 * the pick), both, or neither. A GoalBrew bet placed but never matched says so.
 */
function placedBy(b: { betId: string | null; sizeMatched: number | null; feedMatched: number | null }): string {
  const goalbrew = b.betId !== null && (b.sizeMatched ?? 0) > 0;
  const bfbm = (b.feedMatched ?? 0) > 0;
  if (goalbrew && bfbm) return "Both";
  if (goalbrew) return "GoalBrew";
  if (bfbm) return "Bet feed";
  return b.betId !== null ? "Neither (GoalBrew bet not matched)" : "Neither";
}

/**
 * Every direct betting record as CSV (opens in Excel), oldest first: what was shown and asked, what happened, and
 * alongside it what the betting software's own bet on the same pick got, and the pick's result.
 */
export function directExportCsv(db: EngineDb): string {
  const header = [
    "Time (UK)", "Pick", "Mode", "Outcome", "Bet placed by", "Strategy", "Match", "League", "Minute", "Score", "Market", "Selection",
    "Stake", "Min odds", "Price shown", "Lay shown", "Gap %", "Overround %", "Price asked",
    "Bet id", "Matched", "Avg price matched", "Not matched", "Betfair status", "Profit", "Reason",
    "Feed bet matched", "Feed bet odds", "Feed bet profit", "Pick result", "Last update (UK)",
  ];
  const rows = db.listDirectBetsForExport().map((b) => [
    excelTime(b.createdAt),
    b.pickId,
    b.mode,
    b.state === "shadow" ? "would bet" : b.state,
    placedBy(b),
    b.strategy,
    b.home && b.away ? `${b.home} v ${b.away}` : b.eventName,
    b.competition,
    b.minute,
    b.score,
    b.marketType,
    b.selectionName,
    b.stake,
    b.minPrice,
    b.price,
    b.bestLay,
    b.price !== null ? spreadPct(b.price, b.bestLay) : null,
    b.overround,
    b.askPrice,
    b.betId,
    b.sizeMatched,
    b.avgPrice,
    b.cancelled,
    b.betStatus,
    b.betProfit,
    b.reason,
    b.feedMatched,
    b.feedOdds,
    b.feedProfit,
    b.result,
    excelTime(b.updatedAt),
  ]);
  return toExcelCsv(header, rows);
}
