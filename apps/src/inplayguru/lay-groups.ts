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
 * Never against a Live back bet: no LAY is made from a pick that is being backed Live, nor on a match whose same score
 * already has a next-goal pick backed Live (the two would cancel out, less the spread). One LAY per match and score.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { getSendingSettings, segmentBetFor, strategyLabel } from "./bet-feed";
import { leagueCountryFromText, parseAlert } from "./parse-alert";
import { log } from "../server/log";

export const LAY_CHAT = "lay";

export interface LayGroup {
  /** The first line of its picks, and so its strategy name. Always starts "LAY next goal". */
  header: string;
  test: (p: LivePick, country: string | null) => boolean;
}

const margin = (p: LivePick) => (p.goalsHome === null || p.goalsAway === null ? null : p.goalsHome - p.goalsAway);
const sourceKey = (p: LivePick) => strategyLabel(p.strategy).toLowerCase();

/** In order: a pick in more than one group is laid once, under the first. */
export const LAY_GROUPS: LayGroup[] = [
  { header: "LAY next goal · Japan and Brazil", test: (_p, country) => /^(japan|brazil)$/i.test((country ?? "").trim()) },
  { header: "LAY next goal · Wake-up Call 1 goal apart", test: (p) => sourceKey(p) === "time to fight" && Math.abs(margin(p) ?? 0) === 1 },
  { header: "LAY next goal · Comeback Roast, not home 1 down", test: (p) => sourceKey(p) === "losing team pushing hard" && margin(p) !== null && margin(p) !== -1 },
];

/** The LAY pick's text: the source alert with the group's name on top, and its Hit/Miss ticks (about the back bet) left out. */
export function layText(source: string, group: LayGroup): string {
  const lines = source.replace(/\r/g, "").split("\n");
  const first = lines.findIndex((l) => l.trim().length > 0);
  const body = lines.slice(first + 1).filter((l) => !/[✅❌]/.test(l) && !/^\s*(hit|miss)\s*$/i.test(l));
  return [`🔔 ${group.header}`, ...body].join("\n");
}

const matchScore = (p: LivePick) => `${(p.home ?? "").toLowerCase()}|${(p.away ?? "").toLowerCase()}|${p.goalsHome}-${p.goalsAway}`;

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
  const sources = recent.filter((p) => p.chatId !== LAY_CHAT && p.chatId !== "edge" && p.market === "NEXT_GOAL" && !p.excluded && p.home && p.away);
  const liveScores = new Set(sources.filter(backedLive).map(matchScore));
  let changed = 0;
  for (const p of sources) {
    const group = LAY_GROUPS.find((g) => g.test(p, leagueCountryFromText(p.rawText)));
    if (!group) continue;
    const existing = lays.get(p.id);
    if (!existing) {
      // Only new alerts, never against a Live back bet, and one LAY per match and score.
      if (p.result !== null || p.status === "settled" || backedLive(p) || liveScores.has(matchScore(p)) || laidScores.has(matchScore(p))) continue;
      const text = layText(p.rawText, group);
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
    const group = LAY_GROUPS.find((g) => `🔔 ${g.header}` === lay.rawText.split("\n")[0]);
    if (!source || !group) continue;
    const text = layText(source.rawText, group);
    if (text === lay.rawText) continue;
    db.upsertLivePick(LAY_CHAT, lay.messageId, text, parseAlert(text), lay.messageAt);
    changed++;
  }
  return changed;
}
