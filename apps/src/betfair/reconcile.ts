/**
 * Reconciling the app's estimates with real bets.
 *
 * Every money figure elsewhere in the app is an estimate: the stake the pick was sent with and the price printed in
 * the alert. This module reads the bet history exported from the betting software (BF Bot Manager, or Betfair's own
 * bet history), links each bet to the pick it was placed for, and compares the two, per strategy:
 *
 *   unmatched rate   picks handed to the bet feed that never became a matched bet
 *   slippage         the price actually matched against the price in the alert
 *   profit           the real profit on the bets against the app's estimate for the same picks
 *
 * Importing is safe to repeat: bets are keyed by their bet id, so the same history imported twice changes nothing,
 * and a bet that was unmatched last time and settled now is simply updated.
 *
 * The export's columns are found by name, not position, because exports differ by version and settings. See
 * COLUMNS for the names understood. A file without an event, a time and either a profit or a status is refused
 * with a message naming what is missing, rather than half-imported.
 */
import { createHash } from "node:crypto";
import type { BetfairBet, EngineDb } from "../storage/engine-db";
import { exchangeNamer, strategyLabel } from "../inplayguru/bet-feed";
import { alertOddsOf } from "../server/pricing";
import { pricingInputs } from "../server/winloss";

// ---------------------------------------------------------------------------
// CSV

/** Splits CSV text into rows of fields. Handles quotes, "" inside quotes, CRLF, a BOM, and ; or tab separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  // The separator is whichever of , ; or tab the header line uses most.
  const sep = [",", ";", "\t"].map((c) => ({ c, n: firstLine.split(c).length })).sort((a, b) => b.n - a.n)[0]!.c;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * The text of an uploaded file. Windows programs often save CSV in the old Windows encoding (where £ is a single byte
 * that isn't valid UTF-8) or in UTF-16, so UTF-8 is tried first and the others used when the bytes say so.
 */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// Columns

type Field = "betId" | "placed" | "settled" | "event" | "market" | "selection" | "side" | "provider" | "status" | "stake" | "matched" | "odds" | "profit";

/** Header names understood for each field, compared in lower case with spaces and punctuation removed. First match wins. */
const COLUMNS: Record<Field, string[]> = {
  betId: ["betid", "betref", "betreference", "betno", "betnumber", "reference", "ref", "id"],
  placed: ["placed", "placeddate", "dateplaced", "placedat", "timeplaced", "betplaced", "placedtime", "date", "datetime", "time"],
  settled: ["settled", "settleddate", "datesettled", "settledat", "settledtime", "timesettled"],
  event: ["event", "eventname", "match", "fixture", "eventdescription", "description"],
  market: ["market", "marketname", "markettype"],
  selection: ["selection", "selectionname", "runner", "runnername"],
  side: ["bettype", "side", "backlay", "type"],
  provider: ["provider", "tipster", "strategy", "source", "signal", "tipprovider", "tipsource"],
  status: ["status", "betstatus", "result", "betresult", "outcome", "winlose", "wonlost"],
  stake: ["stake", "requestedstake", "sizerequested", "size", "amount", "requested"],
  matched: ["matched", "matchedstake", "sizematched", "stakematched", "amountmatched", "matchedamount"],
  odds: ["avgpricematched", "averagepricematched", "avgprice", "averageprice", "avgodds", "averageodds", "pricematched", "oddsmatched", "matchedodds", "odds", "price"],
  profit: ["profitloss", "profitandloss", "netprofit", "profit", "pl", "pnl", "netpl", "plgbp", "profitlossgbp"],
};

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function mapColumns(header: string[]): { cols: Partial<Record<Field, number>>; unused: string[] } {
  const keys = header.map(key);
  const cols: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();
  // Fields with the most specific names first, so "matched" isn't taken by "stake" or "price" by "odds".
  const order: Field[] = ["betId", "settled", "placed", "event", "market", "selection", "provider", "status", "matched", "odds", "profit", "stake", "side"];
  for (const f of order) {
    for (const name of COLUMNS[f]) {
      const i = keys.findIndex((k, idx) => k === name && !taken.has(idx));
      if (i >= 0) {
        cols[f] = i;
        taken.add(i);
        break;
      }
    }
  }
  return { cols, unused: header.filter((_, i) => !taken.has(i) && header[i]!.trim() !== "") };
}

// ---------------------------------------------------------------------------
// Values

/**
 * "£1,234.50", "-2.00", "(2.00)" -> number; "" or "-" -> null. Anything that isn't part of a number is dropped, so a
 * currency sign in any spelling (including a £ garbled by the wrong text encoding) never stops an amount being read.
 */
export function parseMoney(v: string | undefined): number | null {
  if (v === undefined) return null;
  let s = v.replace(/[^0-9.()-]/g, "");
  if (s === "" || s === "-" || s === "--") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * The time zone a file's times are written in: an IANA zone such as "Europe/Berlin" (clock changes handled), a fixed
 * number of minutes ahead of UTC, or null for UK time.
 */
export type TimeBasis = string | number | null;

/** Windows time zone names (what the import script reads off the betting PC) for the zones likely to be in use. */
const WINDOWS_ZONES: Record<string, string> = {
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  UTC: "UTC",
  "Coordinated Universal Time": "UTC",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "Irish Standard Time": "Europe/Dublin",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Pacific Standard Time": "America/Los_Angeles",
};

/** An IANA zone for a Windows zone name or an IANA name, or null when it isn't one this can use. */
export function zoneFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const zone = WINDOWS_ZONES[name.trim()] ?? name.trim();
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** Minutes a zone is ahead of UTC at a moment (London: 0 in winter, 60 in summer). */
function zoneOffsetMinutes(utcMs: number, zone: string): number {
  // Worked out on the whole minute: the formatted time has no seconds, so comparing it with a time that has them would
  // round 59.5 minutes down to 59 and put every time with 31+ seconds a minute early.
  const minute = Math.floor(utcMs / 60000) * 60000;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(minute));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round((Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - minute) / 60000);
}

/**
 * A date and time from the export as an ISO string. A time without a zone is read in the given time zone (see
 * TimeBasis; UK time when none is given), because the betting software writes times in its own PC's zone. The import
 * script sends that zone. Understands 01/10/2026 14:03(:22), 2026-10-01 14:03:22, 01-Oct-26 14:03, 1 Oct 2026 14:03,
 * and ISO.
 */
export function parseUkDateTime(v: string | undefined, basis: TimeBasis = null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  if (/\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T]?(.*)$/.exec(s);
  let rest: string;
  if (m) {
    [y, mo, d, rest] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]!];
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s*(.*)$/.exec(s))) {
    [d, mo, y, rest] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]!];
  } else if ((m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4}),?\s*(.*)$/.exec(s))) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (!month) return null;
    [d, mo, y, rest] = [Number(m[1]), month, Number(m[3]), m[4]!];
  } else return null;
  if (y < 100) y += 2000;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(rest.trim());
  const [h, mi, se] = t ? [Number(t[1]), Number(t[2]), Number(t[3] ?? 0)] : [0, 0, 0];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, se);
  if (typeof basis === "number") return new Date(asUtc - basis * 60000).toISOString();
  const zone = basis ?? "Europe/London";
  // Take the offset at the guessed moment, then once more at the corrected one, which settles it either side of a clock change.
  let utc = asUtc - zoneOffsetMinutes(asUtc, zone) * 60000;
  utc = asUtc - zoneOffsetMinutes(utc, zone) * 60000;
  return new Date(utc).toISOString();
}

function statusOf(raw: string | undefined, profit: number | null, matched: number | null): BetfairBet["status"] | null {
  const s = (raw ?? "").toLowerCase();
  if (/void|refund|non.?runner|dead.?heat.?void/.test(s)) return "void";
  if (/lapse|cancel|unmatch|expired|not.?placed|fail|reject/.test(s)) return "unmatched";
  if (/\bwon\b|\bwin\b|winner/.test(s)) return "won";
  if (/\blost\b|\blose\b|loser|\bloss\b/.test(s)) return "lost";
  if (matched !== null && matched <= 0) return "unmatched";
  if (profit !== null) return profit > 0 ? "won" : profit < 0 ? "lost" : "void";
  return null;
}

/**
 * "Arsenal v Chelsea" out of a longer description such as "Football / Arsenal v Chelsea / Match Odds", or BF Bot
 * Manager's "20:00 Arsenal v Chelsea\Over/Under 2.5 Goals\Over 2.5 Goals".
 */
function eventFrom(...texts: Array<string | undefined>): string | null {
  for (const t of texts) {
    if (!t) continue;
    // Parts are split by / | > or a backslash; the match may start with its kick-off time ("20:00 Home v Away").
    for (const part of t.split(/\s*[/|>\\]\s*/)) if (/\s(v|vs|v\.)\s/i.test(part)) return part.trim().replace(/^\d{1,2}:\d{2}\s+/, "");
  }
  return texts.find((t) => t && t.trim())?.trim() ?? null;
}

export interface ParsedHistory {
  bets: BetfairBet[];
  /** Rows that weren't bets (totals, blank lines) or were missing what is needed. */
  skipped: number;
  columns: Partial<Record<Field, string>>;
  unused: string[];
}

/** Reads an exported bet history. Throws an Error whose message says what the file is missing. */
export function parseBetHistory(csv: string, basis: TimeBasis = null): ParsedHistory {
  const rows = parseCsv(csv);
  // The header is the first row that names an event and something money-like; exports sometimes start with a title line.
  const headerIdx = rows.findIndex((r) => {
    const { cols } = mapColumns(r);
    return (cols.event !== undefined || cols.market !== undefined) && (cols.profit !== undefined || cols.status !== undefined || cols.odds !== undefined);
  });
  if (headerIdx < 0) {
    // BF Bot Manager's market results file (one row per finished market and its winner) is easy to export by mistake.
    if (rows[0]?.some((h) => key(h) === "winners") && rows[0].some((h) => key(h) === "winnersprices")) {
      throw new Error("This is a market results file (each market's winner), not your bet history. Export your settled bets instead: one row per bet, with stake, price and profit.");
    }
    throw new Error("Couldn't find the column headings. The file needs at least an Event (or Market) column and a Profit/Loss or Status column.");
  }
  const header = rows[headerIdx]!;
  const { cols, unused } = mapColumns(header);
  if (cols.placed === undefined && cols.settled === undefined) {
    throw new Error("The file has no date or time column (Placed, Settled or Date), so bets can't be matched to picks.");
  }
  const get = (r: string[], f: Field) => (cols[f] === undefined ? undefined : r[cols[f]!]?.trim());

  const bets: BetfairBet[] = [];
  let skipped = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    const event = eventFrom(get(r, "event"), get(r, "market"));
    const placedAt = parseUkDateTime(get(r, "placed"), basis);
    const settledAt = parseUkDateTime(get(r, "settled"), basis);
    const stake = parseMoney(get(r, "stake"));
    const matchedRaw = parseMoney(get(r, "matched"));
    const odds = parseMoney(get(r, "odds"));
    const profit = parseMoney(get(r, "profit"));
    const matched = matchedRaw ?? (cols.matched === undefined ? stake : null);
    const status = statusOf(get(r, "status"), profit, matchedRaw);
    if (!event || (!placedAt && !settledAt) || status === null) {
      skipped++;
      continue;
    }
    const sideRaw = (get(r, "side") ?? "").toLowerCase();
    const side = /lay/.test(sideRaw) ? "lay" : /back/.test(sideRaw) ? "back" : null;
    const selection = get(r, "selection") || null;
    const betId =
      get(r, "betId") ||
      `h:${createHash("sha256").update([event, selection, placedAt ?? settledAt, stake, odds].join("|")).digest("hex").slice(0, 24)}`;
    bets.push({
      betId,
      placedAt,
      settledAt,
      event,
      market: get(r, "market") || null,
      selection,
      side,
      provider: get(r, "provider") || null,
      status,
      stake,
      matched: status === "unmatched" ? 0 : matched,
      odds: odds !== null && odds > 1 ? odds : null,
      profit: status === "unmatched" || status === "void" ? 0 : profit,
    });
  }
  const columns: Partial<Record<Field, string>> = {};
  for (const [f, i] of Object.entries(cols) as Array<[Field, number]>) columns[f] = header[i]!;
  return { bets, skipped, columns, unused };
}

// ---------------------------------------------------------------------------
// Matching bets to picks

const NOISE = new Set(["fc", "afc", "cf", "sc", "ac", "fk", "sk", "if", "bk", "cd", "ud", "the", "de", "club", "u19", "u21", "u23", "w", "women"]);

/** Short forms the exchange and the alerts write differently ("Newcastle Utd" / "Newcastle United"). */
const SPELLED_OUT: Record<string, string> = { utd: "united", untd: "united", ath: "athletic", atl: "atletico", dep: "deportivo", int: "internacional" };

function tokens(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // "O'Higgins" and "OHiggins" are one word.
    .replace(/['\u2019`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !NOISE.has(t))
    .map((t) => SPELLED_OUT[t] ?? t);
}

function teamsOf(event: string): [string[], string[]] | null {
  const m = /^(.*?)\s+(?:v|vs|v\.)\s+(.*)$/i.exec(event.trim());
  return m ? [tokens(m[1]!), tokens(m[2]!)] : null;
}

/**
 * True when every word of the shorter name is in the longer one ("Wolves" and "Wolverhampton Wanderers" do not match,
 * but the feed sends names after the Sending page's aliases, which are the exchange's own names, so they normally agree).
 * A word of 3+ letters may be the start of the other ("Utd" never matches "United"; "Man" matches "Manchester").
 */
function sameTeam(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.every((t) => long.some((u) => u === t || (t.length >= 3 && u.startsWith(t)) || (u.length >= 3 && t.startsWith(u))))) return true;
  // Written with or without spaces ("Hapoel Beer Sheva" / "Hapoel Beersheva").
  const [x, y] = [a.join(""), b.join("")];
  return Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x));
}

/** How well a bet's event matches a pick's: 2 = both teams, 1 = one team, 0 = neither. */
export function eventScore(betEvent: string, pickEvent: string): number {
  const a = teamsOf(betEvent);
  const b = teamsOf(pickEvent);
  if (!a || !b) return 0;
  return (sameTeam(a[0], b[0]) ? 1 : 0) + (sameTeam(a[1], b[1]) ? 1 : 0);
}

/** How long after a pick was sent its bet may be placed: the software can wait for a minimum price. */
const PLACE_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * How long after a pick was sent the bet may be, or null when it can't be its bet. Placed from two minutes before the
 * feed served it (clocks differ) up to PLACE_WINDOW_MS after; a bet with only a settled time may be up to 12 hours on.
 */
function betGap(b: { placedAt: string | null; settledAt: string | null }, sentAt: string): number | null {
  const when = Date.parse(b.placedAt ?? b.settledAt ?? "");
  if (!Number.isFinite(when)) return null;
  const gap = when - Date.parse(sentAt);
  return gap < -2 * 60 * 1000 || gap > (b.placedAt ? PLACE_WINDOW_MS : 12 * 60 * 60 * 1000) ? null : gap;
}

type SentPick = ReturnType<EngineDb["listSentPicks"]>[number];
type Namer = (name: string) => string;
const same: Namer = (n) => n;

const pickEventOf = (p: SentPick) => p.sentRow?.eventName ?? `${p.home ?? ""} v ${p.away ?? ""}`;

/**
 * How well a bet's match fits a pick's: the event as it was sent, or the alert's teams under today's Match names, so a
 * name added later (e.g. from Reconcile) links bets on picks that were sent under the old spelling.
 */
function pickScore(betEvent: string, p: SentPick, namer: Namer): { score: number; event: string } {
  const sent = pickEventOf(p);
  const sentScore = eventScore(betEvent, sent);
  if (sentScore === 2 || !p.home || !p.away) return { score: sentScore, event: sent };
  const now = `${namer(p.home)} v ${namer(p.away)}`;
  const nowScore = eventScore(betEvent, now);
  return nowScore > sentScore ? { score: nowScore, event: now } : { score: sentScore, event: sent };
}

/** "Home v Away" split into the two names as written. */
function splitEvent(event: string): [string, string] | null {
  const m = /^(.*?)\s+(?:v|vs|v\.)\s+(.*)$/i.exec(event.trim());
  return m ? [m[1]!.trim(), m[2]!.trim()] : null;
}

/** A Match names line that would link a bet: the alert's spelling of the team that differs = Betfair's spelling. */
export interface NameSuggestion {
  from: string;
  to: string;
}

/**
 * Why a bet has no pick, in words, so a name that needs a Match names entry can be told from a bet the feed never sent.
 * When one team's name differs, also the Match names line that would fix it (the alert's spelling = Betfair's).
 */
export function explainUnlinked(
  b: Pick<BetfairBet, "placedAt" | "settledAt" | "event">,
  picks: SentPick[],
  namer: Namer = same,
): { reason: string; suggestion: NameSuggestion | null } {
  let nearest: { event: string; score: number; gap: number; pick: SentPick } | null = null;
  for (const p of picks) {
    const gap = betGap(b, p.sentAt);
    if (gap === null) continue;
    const { score, event } = pickScore(b.event, p, namer);
    if (!nearest || score > nearest.score || (score === nearest.score && Math.abs(gap) < nearest.gap)) nearest = { event, score, gap: Math.abs(gap), pick: p };
  }
  if (!nearest) return { reason: "No pick was sent to the bet feed in the 4 hours before this bet, so it wasn't placed from the feed.", suggestion: null };
  if (nearest.score >= 2) return { reason: `Its pick, “${nearest.event}”, already has a bet linked.`, suggestion: null };
  if (nearest.score === 0) {
    return { reason: `No pick for this match was sent around then (the nearest was “${nearest.event}”). If it was one of yours, both team names differ.`, suggestion: null };
  }
  // One team matches: the other is spelled differently. Suggest "alert name = Betfair name" for that one.
  const bet = splitEvent(b.event);
  const { home, away } = nearest.pick;
  let suggestion: NameSuggestion | null = null;
  if (bet && home && away) {
    const homeMatches = eventScore(`${bet[0]} v -`, `${namer(home)} v -`) === 1;
    suggestion = homeMatches ? { from: away, to: bet[1] } : { from: home, to: bet[0] };
  }
  return {
    reason: suggestion
      ? `One team name differs from the pick sent then, “${nearest.event}”: Betfair writes “${suggestion.to}” for the alert’s “${suggestion.from}”.`
      : `One team name differs from the pick sent then, “${nearest.event}”. Add the other under Match names on the Sending page.`,
    suggestion,
  };
}

/** Why a bet has no pick (see explainUnlinked). */
export function unlinkedReason(b: Pick<BetfairBet, "placedAt" | "settledAt" | "event">, picks: SentPick[], namer: Namer = same): string {
  return explainUnlinked(b, picks, namer).reason;
}

/** Links every unlinked bet to the sent pick it was placed for, where one fits. Returns how many were linked. */
export function matchBets(db: EngineDb): number {
  const picks = db.listSentPicks();
  const namer = exchangeNamer(db);
  const bets = db.listBetfairBets();
  const linkedPicks = new Set(bets.filter((b) => b.pickId !== null).map((b) => b.pickId!));
  const links: Array<{ betId: string; pickId: number }> = [];
  for (const b of bets) {
    if (b.pickId !== null || b.acknowledgedAt !== null) continue;
    let best: { id: number; score: number; gap: number } | null = null;
    for (const p of picks) {
      const gap = betGap(b, p.sentAt);
      if (gap === null) continue;
      const ev = pickScore(b.event, p, namer).score;
      if (ev < 2) continue;
      let score = ev;
      if (b.selection && p.sentRow?.selectionName && tokens(b.selection).join(" ") === tokens(p.sentRow.selectionName).join(" ")) score++;
      if (b.provider && p.sentRow?.provider && b.provider.toLowerCase().includes(p.sentRow.provider.trim().toLowerCase())) score++;
      // A pick already holding a bet is a weaker fit, so two bets on one match go to two picks where there are two.
      if (linkedPicks.has(p.id)) score -= 0.5;
      if (!best || score > best.score || (score === best.score && Math.abs(gap) < best.gap)) best = { id: p.id, score, gap: Math.abs(gap) };
    }
    if (best) {
      links.push({ betId: b.betId, pickId: best.id });
      linkedPicks.add(best.id);
    }
  }
  db.linkBetfairBets(links);
  return links.length;
}

// ---------------------------------------------------------------------------
// Import

const LAST_IMPORT_KEY = "betfair_last_import";

export interface ImportSummary {
  at: string;
  source: string;
  rows: number;
  added: number;
  updated: number;
  skipped: number;
  linked: number;
  columns: Partial<Record<Field, string>>;
  unused: string[];
}

export function importBetHistory(db: EngineDb, csv: string, source: string, now = new Date(), basis: TimeBasis = null): ImportSummary {
  const parsed = parseBetHistory(csv, basis);
  if (parsed.bets.length === 0) throw new Error(`No bets found in the file (${parsed.skipped} row${parsed.skipped === 1 ? "" : "s"} skipped). Check it is a bet history export.`);
  const at = now.toISOString();
  const { added, updated } = db.saveBetfairBets(parsed.bets, at);
  const linked = matchBets(db);
  const summary: ImportSummary = { at, source, rows: parsed.bets.length, added, updated, skipped: parsed.skipped, linked, columns: parsed.columns, unused: parsed.unused };
  db.setSetting(LAST_IMPORT_KEY, JSON.stringify(summary));
  return summary;
}

export function lastImport(db: EngineDb): ImportSummary | null {
  try {
    const raw = db.getSetting(LAST_IMPORT_KEY);
    return raw ? (JSON.parse(raw) as ImportSummary) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The report

export interface ReconcileStrategy {
  label: string;
  /** Picks sent to the feed inside the period the imported history covers. */
  sent: number;
  /** Of those, picks with at least one matched bet. */
  matched: number;
  /** Share of sent picks with no matched bet, 0-1. */
  unmatchedRate: number | null;
  /** Settled picks with a matched bet, compared like for like. */
  compared: number;
  estimatedProfit: number;
  actualProfit: number;
  /** Mean of (matched price / alert price - 1) over bets with a reference price (the alert's, else Betfair's when it arrived), e.g. -0.03 = 3% worse. */
  slippage: number | null;
  slippageBets: number;
  /** Bets whose win/loss disagrees with the pick's result (worth checking on the Results page). */
  resultMismatches: number;
}

export type UnlinkedBet = Pick<BetfairBet, "betId" | "placedAt" | "event" | "selection" | "status" | "profit"> & {
  reason: string;
  /** A Match names line that would link it, when one team is spelled differently. */
  suggestion?: NameSuggestion | null;
};

export interface ReconcileReport {
  lastImport: ImportSummary | null;
  /** The span of time the imported bets cover. */
  coverage: { from: string; to: string } | null;
  strategies: ReconcileStrategy[];
  totals: { sent: number; matched: number; compared: number; estimatedProfit: number; actualProfit: number };
  /** Bets that couldn't be tied to a pick and haven't been acknowledged, newest first (at most 100), and how many in all. */
  unlinked: UnlinkedBet[];
  unlinkedCount: number;
  /** Unlinked bets the admin has acknowledged as not from the feed, newest first (at most 100), and how many in all. */
  acknowledged: Array<UnlinkedBet & { acknowledgedAt: string }>;
  acknowledgedCount: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeReconcile(db: EngineDb): ReconcileReport {
  const sentPicks = db.listSentPicks();
  const namer = exchangeNamer(db);
  const allBets = db.listBetfairBets();
  const bets = allBets.filter((b) => b.acknowledgedAt === null);
  const times = bets.map((b) => b.placedAt ?? b.settledAt).filter((t): t is string => t !== null).sort();
  const coverage = times.length > 0 ? { from: times[0]!, to: times[times.length - 1]! } : null;
  const { price } = pricingInputs(db);
  const results = new Map(db.listResultsForWinLoss("1970-01-01T00:00:00.000Z").map((r) => [r.id, r]));
  const betsByPick = new Map<number, typeof bets>();
  for (const b of bets) if (b.pickId !== null) (betsByPick.get(b.pickId) ?? betsByPick.set(b.pickId, []).get(b.pickId)!).push(b);

  const by = new Map<string, ReconcileStrategy & { slipSum: number }>();
  if (coverage) {
    const from = Date.parse(coverage.from) - 5 * 60 * 1000;
    const to = Date.parse(coverage.to);
    for (const p of sentPicks) {
      const sent = Date.parse(p.sentAt);
      if (sent < from || sent > to) continue;
      // A pick only placed by hand (logged on Live) and with nothing on Betfair wasn't meant to come through the feed.
      if (p.viaFeed === false && !betsByPick.has(p.id)) continue;
      const label = strategyLabel(p.strategy);
      const s =
        by.get(label.toLowerCase()) ??
        by.set(label.toLowerCase(), { label, sent: 0, matched: 0, unmatchedRate: null, compared: 0, estimatedProfit: 0, actualProfit: 0, slippage: null, slippageBets: 0, resultMismatches: 0, slipSum: 0 }).get(label.toLowerCase())!;
      s.sent++;
      const real = (betsByPick.get(p.id) ?? []).filter((b) => (b.matched ?? 0) > 0 || b.status === "won" || b.status === "lost");
      if (real.length === 0) continue;
      s.matched++;
      const r = results.get(p.id);
      for (const b of real) {
        // Against the alert's printed price, or for alerts with none, the Betfair price when the alert arrived.
        const alert = r ? (alertOddsOf(r) ?? r.exchangeOdds) : null;
        if (alert && b.odds) {
          s.slipSum += b.odds / alert - 1;
          s.slippageBets++;
        }
      }
      if (!r) continue; // not settled yet, or left out of the figures (fresh start, "didn't actually bet")
      const est = price(r).priced;
      if (est.kind !== "priced" || real.some((b) => b.status !== "won" && b.status !== "lost")) continue;
      s.compared++;
      s.estimatedProfit += est.profit;
      s.actualProfit += real.reduce((n, b) => n + (b.profit ?? 0), 0);
      const won = real.some((b) => b.status === "won");
      if (won !== (r.result === "hit")) s.resultMismatches++;
    }
  }

  const strategies = [...by.values()]
    .map(({ slipSum, ...s }) => ({
      ...s,
      unmatchedRate: s.sent > 0 ? Math.round((1 - s.matched / s.sent) * 1000) / 1000 : null,
      estimatedProfit: r2(s.estimatedProfit),
      actualProfit: r2(s.actualProfit),
      slippage: s.slippageBets > 0 ? Math.round((slipSum / s.slippageBets) * 1000) / 1000 : null,
    }))
    .sort((a, b) => b.sent - a.sent);
  const sum = (f: (s: ReconcileStrategy) => number) => strategies.reduce((n, s) => n + f(s), 0);
  const unlinked = bets.filter((b) => b.pickId === null).reverse();
  const acknowledged = allBets.filter((b) => b.acknowledgedAt !== null).reverse();
  const unlinkedView = (b: (typeof allBets)[number]) => ({ betId: b.betId, placedAt: b.placedAt, event: b.event, selection: b.selection, status: b.status, profit: b.profit });
  return {
    lastImport: lastImport(db),
    coverage,
    strategies,
    totals: {
      sent: sum((s) => s.sent),
      matched: sum((s) => s.matched),
      compared: sum((s) => s.compared),
      estimatedProfit: r2(sum((s) => s.estimatedProfit)),
      actualProfit: r2(sum((s) => s.actualProfit)),
    },
    unlinked: unlinked.slice(0, 100).map((b) => ({ ...unlinkedView(b), ...explainUnlinked(b, sentPicks, namer) })),
    unlinkedCount: unlinked.length,
    acknowledged: acknowledged.slice(0, 100).map((b) => ({ ...unlinkedView(b), reason: "", acknowledgedAt: b.acknowledgedAt! })),
    acknowledgedCount: acknowledged.length,
  };
}
