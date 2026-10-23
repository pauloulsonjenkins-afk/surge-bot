/**
 * LAY GROUPS (added 23 Oct 2026): groups of next-goal alerts that kept LOSING when backed, laid instead.
 *
 * On the record to 22 Oct 2026, at the back price plus a 2-tick spread and 2% commission, these were all profitable laid
 * in both halves of the record:
 *   - Next goal in Japan or Brazil, any strategy: 121 bets, -26.8% backed, about +24% laid.
 *   - Wake-up Call (Time to fight) with the sides one goal apart: 776 bets, -9.1% backed, about +6% laid.
 *   - Comeback Roast (Losing team pushing hard) outside its Golden slice (not home 1 down): 183 bets, -15.3% backed,
 *     about +12% laid (very uneven between the halves).
 *
 * Each qualifying alert gets its OWN pick, a LAY: chat LAY_CHAT, message id = the source pick's id, and the source's
 * text with its first line replaced by the group's name ("🔔 LAY next goal · Japan and Brazil"), so it parses as the
 * NEXT_GOAL_LAY market (lay Over goals so far + 0.5, which wins when no more goals come). Everything else is the usual
 * pipeline: Betfair's LAY price is read when it arrives, it is recorded in Sim, or laid by direct betting when its
 * strategy is switched Live, with the strategy's stake as the liability, maximum lay price, stop loss and limits.
 * The source's later edits (half-time, full time) are copied across, so it settles with the match.
 *
 * Never against a Live back bet: no LAY is made from a pick that is being backed Live, nor when it would cancel out a
 * bet on the same match that is Live (sent, or from a strategy or slice switched Live): see clash.ts. One LAY per
 * match, score and kind of bet.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { getSendingSettings, pickFacts, saveSendingSettings, segmentBetFor, strategyLabel } from "./bet-feed";
import { leagueCountryFromText, parseAlert } from "./parse-alert";
import { clashOf, exposureOf } from "./clash";
import { ruleLabel, ruleTest, type Feature } from "../server/segments";
import { log } from "../server/log";

export const LAY_CHAT = "lay";

export interface LayGroup {
  /** The first line of its picks, and so its strategy name. Starts "LAY next goal" or "LAY home win". */
  header: string;
  /** The source alerts' market: next-goal alerts are laid as the next goal, home-win alerts as the home side. */
  source: "NEXT_GOAL" | "HOME_TO_WIN";
  /** The strategy it lays (its key), or null when it lays alerts from any strategy. */
  lays: string | null;
  /** Why it's laid, in a sentence, for the LAY section. */
  why: string;
  /** Every alert of the strategy it lays, not just some. */
  whole?: boolean;
  /** Added from a lay idea (lay-finder.ts), with its rule; built-in groups have none. */
  rule?: Feature[];
  test: (p: LivePick, country: string | null) => boolean;
}

const margin = (p: LivePick) => (p.goalsHome === null || p.goalsAway === null ? null : p.goalsHome - p.goalsAway);
const sourceKey = (p: LivePick) => strategyLabel(p.strategy).toLowerCase();

/** In order: a pick in more than one group is laid once, under the first. */
export const LAY_GROUPS: LayGroup[] = [
  { header: "LAY next goal · Japan and Brazil", source: "NEXT_GOAL", lays: null, why: "Next-goal alerts in Japan or Brazil, any strategy: -26.8% per £1 backed over 121 bets.", test: (_p, country) => /^(japan|brazil)$/i.test((country ?? "").trim()) },
  { header: "LAY next goal · Wake-up Call 1 goal apart", source: "NEXT_GOAL", lays: "time to fight", why: "Wake-up Call with the sides one goal apart: -9.1% per £1 backed over 776 bets.", test: (p) => sourceKey(p) === "time to fight" && Math.abs(margin(p) ?? 0) === 1 },
  { header: "LAY next goal · Comeback Roast, not home 1 down", source: "NEXT_GOAL", lays: "losing team pushing hard", why: "Comeback Roast outside its Golden slice (not home 1 down): -15.3% per £1 backed over 183 bets.", test: (p) => sourceKey(p) === "losing team pushing hard" && margin(p) !== null && margin(p) !== -1 },
  // Matched odds home (added 23 Oct 2026, Sim): backed it was -10.6% over 132 bets (19-23 Oct); laid about +7.7%.
  { header: "LAY home win · Matched odds home", source: "HOME_TO_WIN", lays: "matched odds home", whole: true, why: "Every Matched odds home alert: -10.6% per £1 backed over 132 bets.", test: (p) => sourceKey(p) === "matched odds home" },
];

const CUSTOM_KEY = "lay_groups_custom";

interface SavedLayGroup {
  strategyKey: string;
  source: "NEXT_GOAL" | "HOME_TO_WIN";
  rule: Feature[];
  why: string;
  addedAt: string;
}

/** A rule's words for a header: no brackets, which would be cut from the strategy name. */
const ruleWords = (rule: Feature[]) => ruleLabel(rule).replace(/^Golden: /, "").replace(/\s*\([^)]*\)/g, "").trim();

function fromSaved(g: SavedLayGroup): LayGroup {
  const test = g.rule.length > 0 ? ruleTest(g.rule) : () => true;
  // The InPlayGuru name, not the display name: the header is the LAY strategy's key, so it must never change.
  const name = g.strategyKey.charAt(0).toUpperCase() + g.strategyKey.slice(1);
  return {
    header: `${g.source === "HOME_TO_WIN" ? "LAY home win" : "LAY next goal"} · ${name}${g.rule.length > 0 ? `: ${ruleWords(g.rule)}` : ""}`,
    source: g.source,
    lays: g.strategyKey,
    whole: g.rule.length === 0,
    why: g.why,
    rule: g.rule,
    test: (p) => sourceKey(p) === g.strategyKey && test(pickFacts(p)),
  };
}

function loadSaved(db: EngineDb): SavedLayGroup[] {
  try {
    const list = JSON.parse(db.getSetting(CUSTOM_KEY) ?? "[]") as SavedLayGroup[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Every LAY group: the built-in ones, then those added from lay ideas (first match wins). */
export function layGroups(db: EngineDb): LayGroup[] {
  return [...LAY_GROUPS, ...loadSaved(db).map((g) => fromSaved(g))];
}

/**
 * Lays a strategy (or one slice of it) from now on, in Sim at a £2 liability: a lay idea the admin chose to watch.
 * Returns the new group. Throws if it's already laid.
 */
export function watchLayGroup(db: EngineDb, strategyKey: string, source: "NEXT_GOAL" | "HOME_TO_WIN", rule: Feature[], why: string, now = new Date()): LayGroup {
  const key = strategyKey.toLowerCase();
  const id = [...rule].sort().join("+");
  const saved = loadSaved(db);
  if (saved.some((g) => g.strategyKey === key && [...g.rule].sort().join("+") === id)) throw new Error("That is already laid.");
  const entry: SavedLayGroup = { strategyKey: key, source, rule, why, addedAt: now.toISOString() };
  db.setSetting(CUSTOM_KEY, JSON.stringify([...saved, entry]));
  const group = fromSaved(entry);
  saveSendingSettings(db, { stakes: { [group.header.toLowerCase()]: 2 } });
  log.info(`LAY group added from a lay idea: ${group.header} (Sim, £2 liability).`);
  return group;
}

/** Stops laying a group added from a lay idea (its picks so far stay). */
export function unwatchLayGroup(db: EngineDb, header: string): void {
  const saved = loadSaved(db);
  const next = saved.filter((g) => fromSaved(g).header.toLowerCase() !== header.toLowerCase());
  if (next.length === saved.length) throw new Error("Only LAY groups added from lay ideas can be stopped here.");
  db.setSetting(CUSTOM_KEY, JSON.stringify(next));
}

/** The LAY pick's text: the source alert with the group's name on top, and its Hit/Miss ticks (about the back bet) left out. */
export function layText(source: string, group: LayGroup): string {
  const lines = source.replace(/\r/g, "").split("\n");
  const first = lines.findIndex((l) => l.trim().length > 0);
  const body = lines.slice(first + 1).filter((l) => !/[✅❌]/.test(l) && !/^\s*(hit|miss)\s*$/i.test(l));
  return [`🔔 ${group.header}`, ...body].join("\n");
}

/** One match, score and kind of bet (goals or the result): a LAY and a back bet clash only on the same kind. */
const matchScore = (p: LivePick) =>
  `${(p.home ?? "").toLowerCase()}|${(p.away ?? "").toLowerCase()}|${p.goalsHome}-${p.goalsAway}|${p.market === "HOME_TO_WIN" || p.market === "HOME_WIN_LAY" ? "result" : "goals"}`;

/** One pass: makes the LAY picks for new qualifying alerts, and copies later edits of their sources. Returns how many changed. */
export function syncLayPicks(db: EngineDb, now = new Date()): number {
  const settings = getSendingSettings(db);
  const recent = db.listLivePicks(1000, { from: new Date(now.getTime() - 6 * 3_600_000).toISOString(), to: now.toISOString() });
  const lays = new Map(recent.filter((p) => p.chatId === LAY_CHAT).map((p) => [p.messageId, p]));
  const laidScores = new Set([...lays.values()].map(matchScore));
  const backedLive = (p: LivePick) => {
    if (p.sentAt) return true;
    const seg = segmentBetFor(settings, p);
    return settings.enabled && (seg ? seg.cfg.live : settings.strategies[sourceKey(p)] === true);
  };
  const sources = recent.filter((p) => p.chatId !== LAY_CHAT && p.chatId !== "edge" && (p.market === "NEXT_GOAL" || p.market === "HOME_TO_WIN") && !p.excluded && p.home && p.away);
  // Bets that are, or will be, Live on each match: the LAY must not cancel any of them out.
  const matchOf = (p: LivePick) => `${(p.home ?? "").toLowerCase()}|${(p.away ?? "").toLowerCase()}`;
  const live = new Map<string, LivePick[]>();
  for (const p of recent) {
    if (p.chatId === LAY_CHAT || p.excluded || !(p.sentAt || (p.chatId !== "edge" && backedLive(p)))) continue;
    live.set(matchOf(p), [...(live.get(matchOf(p)) ?? []), p]);
  }
  let changed = 0;
  const groups = layGroups(db);
  for (const p of sources) {
    const group = groups.find((g) => g.source === p.market && g.test(p, leagueCountryFromText(p.rawText)));
    if (!group) continue;
    const existing = lays.get(p.id);
    if (!existing) {
      // Only new alerts, never against a Live back bet, and one LAY per match and score.
      if (p.result !== null || p.status === "settled" || backedLive(p) || laidScores.has(matchScore(p))) continue;
      const text = layText(p.rawText, group);
      const parsed = parseAlert(text);
      const mine = exposureOf({ market: parsed.market, detail: parsed });
      if ((live.get(matchOf(p)) ?? []).some((b) => clashOf(mine, exposureOf(b)) === "cancels")) continue;
      db.upsertLivePick(LAY_CHAT, p.id, text, parseAlert(text), p.messageAt, p.firstSeenAt);
      laidScores.add(matchScore(p));
      changed++;
      log.info(`LAY pick made from pick ${p.id} (${p.home} v ${p.away}, ${p.goalsHome}-${p.goalsAway}): ${group.header}.`);
    }
  }
  // The source's later edits (half-time, full time): copied to its LAY, up to four days on, until it settles.
  const open = db.listLivePicks(1000, { from: new Date(now.getTime() - 4 * 86_400_000).toISOString(), to: now.toISOString() }).filter((p) => p.chatId === LAY_CHAT && p.result === null);
  for (const lay of open) {
    const source = db.getLivePick(lay.messageId);
    const group = groups.find((g) => `🔔 ${g.header}` === lay.rawText.split("\n")[0]);
    if (!source || !group) continue;
    const text = layText(source.rawText, group);
    if (text === lay.rawText) continue;
    db.upsertLivePick(LAY_CHAT, lay.messageId, text, parseAlert(text), lay.messageAt);
    changed++;
  }
  return changed;
}
