/**
 * TIPMAN CARDS (owner, 22 Nov 2026): the bets on tipmantips.com, tracked as the tipster sets them up: a single, a double
 * or treble, an accumulator, booking bets, a bet builder, each at its own stake in points and at its own combined price.
 *
 * The site is ordinary server-built HTML (a card per bet, a block per leg: time, match, league, selection, market,
 * odds), behind a members' login that is NOT the horse site's. The engine holds no TipMan login, so the page is read in
 * the owner's own signed-in browser by a scheduled Claude task, which posts each card's text as it appears (RawCard, from
 * a small script that copies the strings out of the page and parses nothing). Everything is worked out here, where it is
 * tested: odds, category, stake, kick-off times, which legs Betfair's Exchange can settle.
 *
 *   category   from the card's name: Bet of the Day, Double/Treble, Acca, Booking Bets, Bet Builder, BTTS & Win Acca
 *   stake      the points the card gives ("1pt", "2.5pts"); when it gives none, 1pt, marked as assumed
 *   price      the card's combined price; a bet builder shows none in its header, so the best bookmaker price shown
 *   settling   a leg Betfair lists (match result, both teams to score, goals over/under) is settled from the Exchange's
 *              result for the market. Bookings, cards, corners, players and so on aren't on the Exchange: those legs
 *              (and the card) are marked by hand ("manual") or from TipMan's own result posts.
 *   result     won when every leg won, lost as soon as any leg lost; a void leg drops out of the multiple
 *   profit     in points: pts x (price - 1) won, -pts lost; at the owner's £ per point (default £1) in pounds
 * Nothing is bet: the "Open betslip" links are TipMan's own, for placing by hand.
 */
import type { EngineDb } from "../storage/engine-db";
import type { BetfairReader } from "../betfair/exchange";
import { judgeExchange, searchWord } from "../betfair/exchange";
import { sameOrder } from "../edge/edge-prices";
import { readTipBet } from "./track";
import { sendPush } from "../server/push";
import { ukDateOf } from "../server/uk-time";
import { log } from "../server/log";

export type TipmanCategory = "botd" | "double-treble" | "acca" | "booking" | "bet-builder" | "btts-win-acca" | "other";

export const CATEGORY_LABEL: Record<TipmanCategory, string> = {
  botd: "Bet of the Day",
  "double-treble": "Double / Treble",
  acca: "Accumulator",
  booking: "Booking Bets",
  "bet-builder": "Bet Builder",
  "btts-win-acca": "BTTS & Win Acca",
  other: "Other",
};

/** What the owner's browser script copies out of one card, as text (tipman-read task). */
export interface RawCard {
  id: string;
  free: boolean;
  name: string;
  /** The card header's text: its name and, for most, the combined price ("Todays Free ACCA 4.23/1"). */
  hdr: string;
  /** The card's own note and stake text, if it has any ("1pt double"), joined. */
  note?: string;
  legs: Array<{ w: string; s: string; m: string; o: string }>;
  links: Array<{ u: string; t: string }>;
}

export type LegSettle = "exchange" | "manual";

export interface TipmanLeg {
  /** Kick-off as UTC ISO, or null when the card's date couldn't be read. */
  kickoff: string | null;
  match: string;
  home: string;
  away: string;
  league: string;
  selection: string;
  market: string;
  /** Decimal odds (a fraction "13/25" is 1.52), null when the leg shows none. */
  odds: number | null;
  settle: LegSettle;
  /** Why it can't be settled from the Exchange (manual legs). */
  why?: string;
  marketId?: string;
  selectionId?: number;
  result: "won" | "lost" | "void" | null;
}

export interface TipmanBook {
  book: string;
  url: string;
  /** Decimal price this bookmaker offers for the whole card. */
  odds: number | null;
}

export interface TipmanCard {
  id: string;
  tier: "free" | "premium";
  category: TipmanCategory;
  name: string;
  /** Points staked as the tipster sets it; `ptsAssumed` when the card gave none. */
  pts: number;
  ptsAssumed: boolean;
  /** Decimal price of the whole card. */
  odds: number | null;
  legs: TipmanLeg[];
  books: TipmanBook[];
  /** UK date of the first kick-off, for grouping. */
  day: string;
  firstSeenAt: string;
  updatedAt: string;
  result: "won" | "lost" | "void" | null;
  settledAt: string | null;
  /** "betfair" (settled from the Exchange), "owner" (marked by hand) or "mixed". */
  resultBy: string | null;
  /** "site" (read from the web page) or "screenshot" (read from a Telegram post's images: check the legs). */
  source?: "site" | "screenshot";
  /** Bets that come from one post: a Trixie is three doubles and a treble from the same selections. */
  group?: { id: string; label: string; totalPts: number; bets: number };
  /** The screenshot reader's note, e.g. that it read a leg's odds with low confidence. */
  note?: string;
  /** The owner has put this bet on: when, the stake in pounds actually used, and where. Null/absent until they say so. */
  placed?: { at: string; stake: number; book: string } | null;
  /** Paddy Power's betslip link with exactly THIS bet's legs (its slip doesn't offer a double or treble from a longer list). */
  pad?: string;
}

// --------------------------------------------------------------------------- reading the text

/** "13/25" is 1.52, "4.23/1" is 5.23, "evens" 2, a plain "2.5" is already decimal. Null when it isn't a price. */
export function fractionToDecimal(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (/^(evs|evens)$/.test(s)) return 2;
  const f = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (f) {
    const d = Number(f[2]);
    return d > 0 ? Math.round((Number(f[1]) / d + 1) * 1000) / 1000 : null;
  }
  const dec = /^(\d+(?:\.\d+)?)$/.exec(s);
  return dec && Number(dec[1]) > 1 ? Number(dec[1]) : null;
}

/** The price at the end of a text: "Todays Free ACCA 4.23/1" -> 5.23; "Returns £22.60 1.26/1" -> 2.26. */
function trailingPrice(text: string): number | null {
  const m = /(\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|evens|evs)\s*$/i.exec(text.trim());
  return m ? fractionToDecimal(m[1]!) : null;
}

export function categoryOf(name: string, legs: Array<{ match: string }>): TipmanCategory {
  const n = name.toLowerCase();
  if (/btts.*(&|and|\+).*win|win.*(&|and|\+).*btts/.test(n)) return "btts-win-acca";
  if (/botd|bet of the day/.test(n)) return "botd";
  if (/double|treble/.test(n)) return "double-treble";
  if (/booking/.test(n)) return "booking";
  if (/bet ?builder|build a bet/.test(n)) return "bet-builder";
  if (/acca|accumulator/.test(n)) return "acca";
  // A card named only for its match ("Liverpool v Manchester Utd") with several legs in that one match is a bet builder.
  if (legs.length > 1 && new Set(legs.map((l) => l.match.toLowerCase())).size === 1) return "bet-builder";
  return "other";
}

/** The points a card stakes: "1pt", "2.5 pts", "0.5 point" anywhere in its header or note. Null when it gives none. */
export function pointsOf(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:pts?|points?)\b/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
}

const BOOKS: Array<[RegExp, string]> = [
  [/betfair/i, "Betfair"],
  [/paddypower/i, "Paddy Power"],
  [/skybet/i, "Sky Bet"],
  [/bet365/i, "bet365"],
  [/betmgm/i, "BetMGM"],
  [/betsbk|sbk/i, "SBK"],
];
const bookOf = (url: string): string => BOOKS.find(([re]) => re.test(url))?.[1] ?? "Other";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Minutes Europe/London is ahead of UTC at an instant. */
function londonOffsetMin(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return (Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - at.getTime()) / 60_000;
}

/** "22 Nov 16:15" (UK time, the year taken from `now`) as a UTC ISO time. Null when it doesn't read. */
export function kickoffOf(text: string, now: Date): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2]!.toLowerCase());
  if (mon < 0) return null;
  let year = Number(ukDateOf(now).slice(0, 4));
  const guess = (y: number) => Date.UTC(y, mon, Number(m[1]), Number(m[3]), Number(m[4]));
  // A date months in the past is next year's (a card read in late December for early January).
  if (guess(year) < now.getTime() - 180 * 86_400_000) year++;
  const naive = guess(year);
  const first = londonOffsetMin(new Date(naive));
  let at = naive - first * 60_000;
  // Settled against the offset at the instant itself, so a time just either side of a clock change reads right.
  const second = londonOffsetMin(new Date(at));
  if (second !== first) at = naive - second * 60_000;
  return new Date(at).toISOString();
}

/** One leg's "22 Nov 14:00 - Hull vs Brighton - Premier League" split into its parts. */
function splitWhen(w: string): { when: string; match: string; league: string } {
  const m = /^(\d{1,2}\s+[A-Za-z]{3}\s+\d{1,2}:\d{2})\s*-\s*(.+?)(?:\s+-\s+(.+))?$/.exec(w.trim());
  return m ? { when: m[1]!, match: m[2]!.trim(), league: (m[3] ?? "").trim() } : { when: "", match: w.trim(), league: "" };
}

export function sides(match: string): { home: string; away: string } {
  const m = /^(.+?)\s+(?:vs\.?|v)\s+(.+)$/i.exec(match.trim());
  return m ? { home: m[1]!.trim(), away: m[2]!.trim() } : { home: match.trim(), away: "" };
}

/** Whether Betfair's Exchange can settle a leg, by the same reading the Telegram tips use (tips/track.ts readTipBet). */
export function settleOf(selection: string, market: string, home: string, away: string): { settle: LegSettle; why?: string } {
  if (!away) return { settle: "manual", why: "The match wasn't read." };
  const bet = readTipBet(selection, market, home, away);
  return "reason" in bet ? { settle: "manual", why: bet.reason } : { settle: "exchange" };
}

/** A card from the page's text, worked out. Returns null for something that isn't a bet (no id or no legs). Pure. */
export function normaliseCard(raw: RawCard, now: Date): TipmanCard | null {
  if (!raw || typeof raw.id !== "string" || !/^\d+$/.test(raw.id) || !Array.isArray(raw.legs) || raw.legs.length === 0 || raw.legs.length > 12) return null;
  const legs: TipmanLeg[] = raw.legs.map((l) => {
    const { when, match, league } = splitWhen(String(l.w ?? ""));
    const { home, away } = sides(match);
    const selection = String(l.s ?? "").trim();
    const market = String(l.m ?? "").trim();
    return { kickoff: kickoffOf(when, now), match, home, away, league, selection, market, odds: fractionToDecimal(String(l.o ?? "")), ...settleOf(selection, market, home, away), result: null };
  });
  const name = String(raw.name ?? "").trim().slice(0, 80);
  const books: TipmanBook[] = (Array.isArray(raw.links) ? raw.links : []).slice(0, 8).map((k) => ({ book: bookOf(String(k.u)), url: String(k.u).slice(0, 700), odds: trailingPrice(String(k.t ?? "")) }));
  const header = trailingPrice(String(raw.hdr ?? "").replace(name, ""));
  const bestBook = books.reduce<number | null>((best, b) => (b.odds !== null && (best === null || b.odds > best) ? b.odds : best), null);
  const pts = pointsOf(`${raw.hdr ?? ""} ${raw.note ?? ""}`);
  const first = legs.map((l) => l.kickoff).filter((k): k is string => k !== null).sort()[0];
  return {
    id: raw.id,
    tier: raw.free ? "free" : "premium",
    category: categoryOf(name, legs),
    name,
    pts: pts ?? 1,
    ptsAssumed: pts === null,
    // A single's price is its one leg; a bet builder's isn't the product of its legs, so the bookmakers' own price.
    odds: header ?? (legs.length === 1 ? legs[0]!.odds : null) ?? bestBook,
    legs,
    books,
    day: ukDateOf(first ? new Date(first) : now),
    firstSeenAt: now.toISOString(),
    updatedAt: now.toISOString(),
    result: null,
    settledAt: null,
    resultBy: null,
  };
}

// --------------------------------------------------------------------------- results and money

const legKey = (l: Pick<TipmanLeg, "match" | "selection">) => `${l.match.toLowerCase()}|${l.selection.toLowerCase()}`;

/** A card's result from its legs. Null while it can't be known yet. Pure. */
export function cardResultFrom(legs: Array<Pick<TipmanLeg, "result">>): "won" | "lost" | "void" | null {
  if (legs.some((l) => l.result === "lost")) return "lost";
  if (legs.some((l) => l.result === null)) return null;
  return legs.every((l) => l.result === "void") ? "void" : "won";
}

/** Points won or lost on a settled card. Null while unsettled or void. Pure. */
export function profitPts(card: Pick<TipmanCard, "pts" | "odds" | "result">): number | null {
  if (card.result === "lost") return -card.pts;
  if (card.result === "won" && card.odds !== null) return Math.round(card.pts * (card.odds - 1) * 100) / 100;
  return null;
}

const POINT_VALUE_KEY = "tipman_point_value";
export function pointValue(db: EngineDb): number {
  const v = Number(db.getSetting(POINT_VALUE_KEY));
  return Number.isFinite(v) && v > 0 && v <= 1000 ? v : 1;
}
export function setPointValue(db: EngineDb, v: number): number {
  if (!(v > 0 && v <= 1000)) throw new Error("£ per point must be above 0 and at most 1000.");
  db.setSetting(POINT_VALUE_KEY, String(v));
  return v;
}

// --------------------------------------------------------------------------- storing

function load(db: EngineDb, id: string): TipmanCard | null {
  const raw = db.getTipmanCardJson(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TipmanCard;
  } catch {
    return null;
  }
}

function save(db: EngineDb, c: TipmanCard): void {
  db.saveTipmanCard({ id: c.id, day: c.day, tier: c.tier, category: c.category, json: JSON.stringify(c), firstSeenAt: c.firstSeenAt, result: c.result, settledAt: c.settledAt });
}

export function listCards(db: EngineDb, sinceDay: string): TipmanCard[] {
  return db
    .listTipmanCardJson(sinceDay)
    .map((r) => {
      try {
        return JSON.parse(r) as TipmanCard;
      } catch {
        return null;
      }
    })
    .filter((c): c is TipmanCard => c !== null);
}

/**
 * Stores what the browser read. A card seen before keeps its state (legs already resolved on the Exchange, results, who
 * settled it) while its price, stake and bookmaker links are refreshed; a leg the site changed starts again. Returns the
 * cards that are new, and how many were skipped as not bets.
 */
export function recordCards(db: EngineDb, raws: RawCard[], now = new Date()): { added: TipmanCard[]; updated: number; skipped: number } {
  const added: TipmanCard[] = [];
  let updated = 0;
  let skipped = 0;
  for (const raw of raws) {
    const fresh = normaliseCard(raw, now);
    if (!fresh) {
      skipped++;
      continue;
    }
    const old = load(db, fresh.id);
    if (!old) {
      // The same bet already read from a screenshot: the page's own text is the better record (exact odds and points), so it
      // replaces that one and keeps what was marked on it, but it is not new, so it isn't notified again.
      const dup = findDuplicate(db, fresh, now);
      if (dup) {
        const was = new Map(dup.legs.map((l) => [legKey(l), l]));
        const legs = fresh.legs.map((l) => ({ ...l, result: was.get(legKey(l))?.result ?? l.result }));
        db.deleteTipmanCard(dup.id);
        save(db, { ...fresh, legs, firstSeenAt: dup.firstSeenAt, result: dup.result, settledAt: dup.settledAt, resultBy: dup.resultBy, placed: dup.placed });
        updated++;
        continue;
      }
      save(db, fresh);
      added.push(fresh);
      continue;
    }
    const oldLegs = new Map(old.legs.map((l) => [legKey(l), l]));
    const legs = fresh.legs.map((l) => {
      const was = oldLegs.get(legKey(l));
      return was ? { ...l, marketId: was.marketId, selectionId: was.selectionId, result: was.result } : l;
    });
    save(db, { ...fresh, legs, firstSeenAt: old.firstSeenAt, result: old.result, settledAt: old.settledAt, resultBy: old.resultBy, placed: old.placed });
    updated++;
  }
  return { added, updated, skipped };
}

/** The phone notification for a new premium card: what it is, its stake and its price. */
export async function notifyNewCards(db: EngineDb, added: TipmanCard[]): Promise<void> {
  for (const c of added.filter((x) => x.tier === "premium")) {
    const legs = c.legs.length === 1 ? `${c.legs[0]!.selection}, ${c.legs[0]!.match}` : `${c.legs.length} selections`;
    await sendPush(db, {
      title: `TipMan Premium: ${CATEGORY_LABEL[c.category]}`,
      body: `${c.pts}pt${c.ptsAssumed ? " (assumed)" : ""} · ${legs}${c.odds !== null ? ` @ ${c.odds.toFixed(2)}` : ""}. Tap for the legs and the betslip.`,
      url: "/more/admin/tipman",
      tag: `tipman-${c.id}`,
    });
  }
}

const plainMatch = (m: string) => m.toLowerCase().replace(/\bvs?\.?\b/g, " v ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const plainSelection = (sel: string) =>
  sel
    .toLowerCase()
    .replace(/\b(to win|win|wins)\b/g, " ")
    .replace(/[^a-z0-9+. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * What a bet IS, whichever post or page it came from: its legs (the match and what is backed in it, worded loosely so "Man City
 * to win" and "Man City Win" are the same), in any order. Two bets with the same signature are the same bet.
 */
export function legSignature(c: Pick<TipmanCard, "legs">): string {
  return c.legs
    .map((l) => `${plainMatch(l.match)}|${plainSelection(l.selection)}`)
    .sort()
    .join("+");
}

/** A stored bet of the last three days, of the same tier, with these legs under another id (the same bet again, from a repost or the other source). A free bet and a premium one with the same legs are different bets (own stake, own alert). */
export function findDuplicate(db: EngineDb, card: TipmanCard, now = new Date()): TipmanCard | null {
  const sig = legSignature(card);
  return listCards(db, ukDateOf(new Date(now.getTime() - 3 * 86_400_000))).find((c) => c.id !== card.id && c.tier === card.tier && legSignature(c) === sig) ?? null;
}

/**
 * Stores cards built elsewhere (the screenshot reader). A card already stored by id is left as it is, and a bet whose legs
 * are already stored under another id (the same bet reposted, or read from the page as well) is not stored again: it would
 * be counted twice and notified twice. Returns the new ones.
 */
export function storeCards(db: EngineDb, cards: TipmanCard[]): TipmanCard[] {
  const added: TipmanCard[] = [];
  for (const c of cards) {
    if (load(db, c.id) || findDuplicate(db, c, new Date(c.firstSeenAt))) continue;
    save(db, c);
    added.push(c);
  }
  return added;
}

const CARRY_KEY = "tipman_carry";
interface Carried {
  placed: TipmanCard["placed"];
  result: TipmanCard["result"];
  settledAt: string | null;
  resultBy: string | null;
  legs: Record<string, TipmanLeg["result"]>;
}
const readCarry = (db: EngineDb): Record<string, Carried> => {
  try {
    return JSON.parse(db.getSetting(CARRY_KEY) ?? "{}") as Record<string, Carried>;
  } catch {
    return {};
  }
};

/**
 * Before stored bets are deleted to be read again (a new reader version), keeps what the owner did on them (placed, results
 * marked by hand or settled), by the bet's legs, so the rebuilt bet gets it back (applyCarried). Returns how many were kept.
 */
export function carryState(db: EngineDb, cards: TipmanCard[]): number {
  const carry = readCarry(db);
  let n = 0;
  for (const c of cards) {
    const legs = Object.fromEntries(c.legs.filter((l) => l.result !== null).map((l) => [legKey(l), l.result]));
    if (!c.placed && c.result === null && Object.keys(legs).length === 0) continue;
    carry[`${c.tier}|${legSignature(c)}`] = { placed: c.placed ?? null, result: c.result, settledAt: c.settledAt, resultBy: c.resultBy, legs };
    n++;
  }
  if (n > 0) db.setSetting(CARRY_KEY, JSON.stringify(carry));
  return n;
}

/** The rebuilt bets, each with what was carried for the same bet (used once). */
export function applyCarried(db: EngineDb, cards: TipmanCard[]): TipmanCard[] {
  const carry = readCarry(db);
  if (Object.keys(carry).length === 0) return cards;
  const out = cards.map((c) => {
    const k = `${c.tier}|${legSignature(c)}`;
    const k0 = carry[k];
    if (!k0) return c;
    delete carry[k];
    return { ...c, placed: k0.placed, result: k0.result, settledAt: k0.settledAt, resultBy: k0.resultBy, legs: c.legs.map((l) => ({ ...l, result: k0.legs[legKey(l)] ?? l.result })) };
  });
  db.setSetting(CARRY_KEY, JSON.stringify(carry));
  return out;
}

/**
 * The owner marks one LEG by hand (a booking, a card, a player bet: none are on the Exchange): every stored card with that
 * leg takes the result, so a Trixie's four bets all update from one tap, and each card's result follows from its legs.
 * Returns how many cards changed.
 */
export function setLegResultByHand(db: EngineDb, match: string, selection: string, result: "won" | "lost" | "void" | null, now = new Date()): number {
  const key = legKey({ match, selection });
  let changed = 0;
  for (const c of listCards(db, ukDateOf(new Date(now.getTime() - 5 * 86_400_000)))) {
    if (!c.legs.some((l) => legKey(l) === key)) continue;
    const legs = c.legs.map((l) => (legKey(l) === key ? { ...l, result } : l));
    const decided = cardResultFrom(legs);
    save(db, { ...c, legs, result: decided, settledAt: decided ? now.toISOString() : null, resultBy: decided ? (c.resultBy === "betfair" ? "mixed" : "owner") : null, updatedAt: now.toISOString() });
    changed++;
  }
  return changed;
}

/**
 * "I've put this bet on" (owner, 22 Nov 2026: a way of tracking that the right bets were placed): the stake actually used and
 * where. Null takes it back. For a whole post at once (a Trixie's four bets) every bet of its group is marked at its advised
 * stake (points x the £ per point) unless `stake` is given. Returns how many bets changed.
 */
export function setPlaced(db: EngineDb, target: { id?: string; group?: string }, placed: boolean, opts: { stake?: number; book?: string } = {}, now = new Date()): number {
  const cards = listCards(db, ukDateOf(new Date(now.getTime() - 5 * 86_400_000))).filter((c) => (target.group ? c.group?.id === target.group : c.id === target.id));
  const pv = pointValue(db);
  let n = 0;
  for (const c of cards) {
    const stake = Math.round((opts.stake ?? c.pts * pv) * 100) / 100;
    if (placed && !(stake > 0 && stake <= 100_000)) throw new Error("Give the stake in pounds, above 0.");
    save(db, { ...c, placed: placed ? { at: now.toISOString(), stake, book: (opts.book ?? "Paddy Power").slice(0, 30) } : null, updatedAt: now.toISOString() });
    n++;
  }
  if (n === 0) throw new Error("That bet isn't stored.");
  return n;
}

export interface PlacedSummary {
  /** Bets the owner has marked placed, the pounds staked on them, how many have settled, and the pounds won or lost on those (at the advised price). */
  bets: number;
  staked: number;
  settled: number;
  profit: number;
  /** Bets still to place: not marked placed, not settled, and not yet kicked off. */
  toPlace: number;
}

/** What the owner has put on, and what is still to place. Pure. */
export function placedSummary(cards: TipmanCard[], now = new Date()): PlacedSummary {
  const out: PlacedSummary = { bets: 0, staked: 0, settled: 0, profit: 0, toPlace: 0 };
  for (const c of cards) {
    const ko = c.legs.map((l) => l.kickoff).filter((k): k is string => k !== null).sort()[0];
    if (!c.placed) {
      if (c.result === null && (!ko || Date.parse(ko) > now.getTime())) out.toPlace++;
      continue;
    }
    out.bets++;
    out.staked += c.placed.stake;
    if (c.result === "lost") {
      out.settled++;
      out.profit -= c.placed.stake;
    } else if (c.result === "won" && c.odds !== null) {
      out.settled++;
      out.profit += c.placed.stake * (c.odds - 1);
    }
  }
  return { ...out, staked: Math.round(out.staked * 100) / 100, profit: Math.round(out.profit * 100) / 100 };
}

/** The owner marks a card (or one leg of it) won, lost or void by hand: bookings, cards and players aren't on the Exchange. */
export function setResultByHand(db: EngineDb, id: string, result: "won" | "lost" | "void", now = new Date()): TipmanCard {
  const c = load(db, id);
  if (!c) throw new Error("That card isn't stored.");
  save(db, { ...c, result, settledAt: now.toISOString(), resultBy: "owner" });
  return load(db, id)!;
}

// --------------------------------------------------------------------------- settling

/** After kick-off this long a match is over and its market settled. */
const SETTLE_AFTER_MS = 2.5 * 3_600_000;
/** After this long a leg Betfair never settled is left for the owner. */
const GIVE_UP_MS = 36 * 3_600_000;

type Reader = Pick<BetfairReader, "searchEvents" | "checkBet" | "runnerResult">;

/** Looks up a leg's market and selection on the Exchange. Returns the leg with them filled in, or marked manual. */
async function resolveLeg(reader: Reader, leg: TipmanLeg): Promise<TipmanLeg> {
  if (leg.marketId || leg.settle !== "exchange" || !leg.kickoff) return leg;
  const bet = readTipBet(leg.selection, leg.market, leg.home, leg.away);
  if ("reason" in bet) return { ...leg, settle: "manual", why: bet.reason };
  const at = new Date(leg.kickoff);
  const find = async (word: string) => judgeExchange(leg.home, leg.away, await reader.searchEvents(word, at));
  let judged = await find(searchWord(leg.home));
  if (judged.result === "off") judged = await find(searchWord(leg.away));
  if (judged.result !== "on" || !judged.eventId || !judged.event || !sameOrder(leg.home, leg.away, judged.event)) return { ...leg, settle: "manual", why: "Betfair doesn't list this match." };
  const [bfHome = leg.home, bfAway = leg.away] = judged.event.split(/ v /i).map((s) => s.trim());
  const selectionName = bet.selectionName === "home" ? bfHome : bet.selectionName === "away" ? bfAway : bet.selectionName === "draw" ? "The Draw" : bet.selectionName;
  const check = await reader.checkBet(judged.eventId, bet.marketType, selectionName);
  if (check.status !== "ok" || check.marketId === undefined || check.selectionId === undefined) return { ...leg, settle: "manual", why: "Betfair has no such market." };
  return { ...leg, marketId: check.marketId, selectionId: check.selectionId };
}

let settling = false;

/**
 * Settles what has finished: every open card's legs that the Exchange can settle, then the card from its legs. A leg that
 * can't be settled there waits for the owner (setResultByHand), and a card with a lost leg is lost at once. Returns how
 * many cards were settled this pass.
 */
export async function settleCards(db: EngineDb, reader: Reader | null, now = new Date()): Promise<number> {
  if (settling || !reader) return 0;
  settling = true;
  let settled = 0;
  try {
    const since = new Date(now.getTime() - 4 * 86_400_000);
    for (const card of listCards(db, ukDateOf(since)).filter((c) => c.result === null)) {
      let changed = false;
      const legs: TipmanLeg[] = [];
      for (const leg0 of card.legs) {
        let leg = leg0;
        const ko = leg.kickoff ? Date.parse(leg.kickoff) : null;
        try {
          if (leg.result === null && leg.settle === "exchange" && ko !== null) {
            if (!leg.marketId) leg = await resolveLeg(reader, leg);
            if (leg.marketId && leg.selectionId !== undefined && now.getTime() >= ko + SETTLE_AFTER_MS) {
              const r = await reader.runnerResult(leg.marketId, leg.selectionId).catch(() => null);
              if (r === "WINNER") leg = { ...leg, result: "won" };
              else if (r === "LOSER") leg = { ...leg, result: "lost" };
              else if (r === "REMOVED") leg = { ...leg, result: "void" };
              else if (now.getTime() > ko + GIVE_UP_MS) leg = { ...leg, settle: "manual", why: "Betfair never settled this market." };
            }
          }
        } catch (err) {
          log.warn(`TipMan: leg ${leg.selection} (${leg.match}): ${err instanceof Error ? err.message : String(err)}`);
        }
        if (leg !== leg0) changed = true;
        legs.push(leg);
      }
      // Manual legs have no result until the owner gives one on the card, so only a lost Exchange leg can finish a card early.
      if (!changed) continue;
      // The look-ups above took time: the owner may have marked this bet (placed, a leg, the card) meanwhile, so it is read again
      // and only what was found is merged in. A result they gave is never replaced.
      const cur = load(db, card.id);
      if (!cur || cur.result !== null) continue;
      const found = new Map(legs.map((l) => [legKey(l), l]));
      const merged = cur.legs.map((l) => {
        const f = found.get(legKey(l));
        if (!f) return l;
        return { ...l, marketId: f.marketId ?? l.marketId, selectionId: f.selectionId ?? l.selectionId, settle: f.settle, why: f.why ?? l.why, result: l.result ?? f.result };
      });
      const result = cardResultFrom(merged);
      if (result !== null) {
        const by = merged.some((l) => l.settle === "manual") ? "mixed" : "betfair";
        save(db, { ...cur, legs: merged, result, settledAt: now.toISOString(), resultBy: by, updatedAt: now.toISOString() });
        settled++;
      } else {
        save(db, { ...cur, legs: merged, updatedAt: now.toISOString() });
      }
    }
  } finally {
    settling = false;
  }
  if (settled > 0) log.info(`TipMan: ${settled} card${settled === 1 ? "" : "s"} settled.`);
  return settled;
}

// --------------------------------------------------------------------------- the record

export interface CategoryRecord {
  category: TipmanCategory;
  tier: "free" | "premium";
  cards: number;
  settled: number;
  won: number;
  lost: number;
  /** Points staked on settled cards, and points won or lost. */
  stakedPts: number;
  profitPts: number;
}

/** Each category's record, premium and free apart. Pure. */
export function recordOf(cards: TipmanCard[]): CategoryRecord[] {
  const by = new Map<string, CategoryRecord>();
  for (const c of cards) {
    const k = `${c.tier}|${c.category}`;
    const r = by.get(k) ?? { category: c.category, tier: c.tier, cards: 0, settled: 0, won: 0, lost: 0, stakedPts: 0, profitPts: 0 };
    r.cards++;
    if (c.result === "won" || c.result === "lost") {
      r.settled++;
      if (c.result === "won") r.won++;
      else r.lost++;
      r.stakedPts += c.pts;
      r.profitPts += profitPts(c) ?? 0;
    }
    by.set(k, r);
  }
  return [...by.values()].map((r) => ({ ...r, stakedPts: Math.round(r.stakedPts * 100) / 100, profitPts: Math.round(r.profitPts * 100) / 100 }));
}
