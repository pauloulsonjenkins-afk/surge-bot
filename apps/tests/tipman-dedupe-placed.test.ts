/** One alert per TipMan bet, a record of which the owner has placed, and notifications focused on TipMan and the summaries. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { buildScreenCards, notifyScreenPost, type VisionRead } from "../src/tips/tipman-screens";
import { findDuplicate, legSignature, listCards, placedSummary, recordCards, setPlaced, setPointValue, setResultByHand, storeCards, type RawCard } from "../src/tips/tipman-cards";
import { pushKind, pushFocused, sendPush, setPushFocused } from "../src/server/push";

const NOW = new Date("2026-11-22T10:00:00Z");
const sel = (match: string, selection: string, odds: string) => ({ match, league: "Premier League", kickoff: "22 Nov 15:00", selection, market: "Match Result", odds });
const villaRead = (): VisionRead => ({ kind: "selections", selections: [sel("Villa v Sunderland", "Villa to win", "4/5")], bets: [{ name: "Bet of the Day", shape: "single", pts: "5pts", price: "4/5", selections: [sel("Villa v Sunderland", "Villa to win", "4/5")] }], totalOdds: "", stake: "", confidence: "high", notes: "" });
const post = (messageId: number) => buildScreenCards({ messageId, caption: "Premium BOTD", read: villaRead(), links: [], now: NOW });
const siteVilla: RawCard = { id: "555", free: false, name: "Premium BOTD", hdr: "Premium BOTD 4/5 5pts", legs: [{ w: "22 Nov 15:00 - Villa vs Sunderland - Premier League", s: "Villa Win", m: "Match Result", o: "" }], links: [] };

test("a bet is the same bet whichever post or page it came from: wording and order don't matter", () => {
  const a = post(1)[0]!;
  assert.equal(legSignature(a), legSignature(post(2)[0]!));
  const site = recordCards(new EngineDb(":memory:", () => {}), [siteVilla], NOW).added[0]!;
  assert.equal(legSignature(a), legSignature(site), "'Villa to win', Villa v Sunderland = 'Villa Win', Villa vs Sunderland");
  const other = post(3)[0]!;
  other.legs[0] = { ...other.legs[0]!, selection: "Villa to win or draw" };
  assert.notEqual(legSignature(a), legSignature(other), "a different bet on the same match is a different bet");
});

test("the same bet reposted is stored once, counted once and so notified once", async () => {
  const db = new EngineDb(":memory:", () => {});
  const first = storeCards(db, post(100));
  assert.equal(first.length, 1);
  const again = storeCards(db, post(101));
  assert.deepEqual(again, [], "reposted: nothing new, so no second notification");
  assert.equal(listCards(db, "2026-11-22").length, 1);
  assert.equal(findDuplicate(db, post(102)[0]!, NOW)?.id, first[0]!.id);
  await notifyScreenPost(db, first, []);
  await notifyScreenPost(db, again, []);
  assert.equal(db.listPushLog(10).length, 1, "one notification for the one bet");
});

test("the page's own record of a bet replaces the screenshot's, keeps what was marked on it and isn't notified again", () => {
  const db = new EngineDb(":memory:", () => {});
  const [shot] = storeCards(db, post(100));
  setPlaced(db, { id: shot!.id }, true, { stake: 5 }, NOW);
  setResultByHand(db, shot!.id, "won", NOW);
  const r = recordCards(db, [siteVilla], NOW);
  assert.deepEqual([r.added.length, r.updated], [0, 1], "not new");
  const cards = listCards(db, "2026-11-22");
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.id, "555");
  assert.equal(cards[0]!.result, "won");
  assert.equal(cards[0]!.placed?.stake, 5);
  assert.equal(cards[0]!.source, undefined, "now the page's text");
});

test("marking bets placed: one, or a whole post at its advised stakes, and taking it back", () => {
  const db = new EngineDb(":memory:", () => {});
  setPointValue(db, 2);
  const trixie = buildScreenCards({
    messageId: 200,
    caption: "Premium Bookings\n1pt for all 3 doubles and a 1pt treble (4pt total)",
    read: { kind: "selections", selections: [sel("A v B", "A to be carded", "5/2"), sel("C v D", "C to be carded", "11/4"), sel("E v F", "E to be carded", "7/2")], totalOdds: "", stake: "", confidence: "high", notes: "" },
    links: [],
    now: NOW,
  });
  storeCards(db, trixie);
  const group = trixie[0]!.group!.id;
  assert.equal(placedSummary(listCards(db, "2026-11-22"), NOW).toPlace, 4);
  assert.equal(setPlaced(db, { id: trixie[0]!.id }, true, { stake: 3.5, book: "Betfair" }, NOW), 1);
  let s = placedSummary(listCards(db, "2026-11-22"), NOW);
  assert.deepEqual([s.bets, s.staked, s.toPlace], [1, 3.5, 3]);
  assert.equal(setPlaced(db, { group }, true, {}, NOW), 4, "the whole post");
  const all = listCards(db, "2026-11-22");
  assert.ok(all.every((c) => c.placed && c.placed.stake === 2 && c.placed.book === "Paddy Power"), "advised 1pt x £2 per point");
  s = placedSummary(all, NOW);
  assert.deepEqual([s.bets, s.staked, s.toPlace], [4, 8, 0]);
  assert.equal(setPlaced(db, { group }, false, {}, NOW), 4);
  assert.equal(placedSummary(listCards(db, "2026-11-22"), NOW).bets, 0);
  assert.throws(() => setPlaced(db, { id: "nope" }, true), /isn't stored/);
  assert.throws(() => setPlaced(db, { id: trixie[0]!.id }, true, { stake: 0 }), /above 0/);
});

test("what was placed and how it did: pounds at the stake used and the price, unplaced settled bets and future ones counted separately", () => {
  const mk = (over: Partial<ReturnType<typeof post>[number]>) => ({ ...post(1)[0]!, ...over });
  const won = mk({ id: "w", odds: 3, result: "won", placed: { at: NOW.toISOString(), stake: 10, book: "Paddy Power" } });
  const lost = mk({ id: "l", odds: 2, result: "lost", placed: { at: NOW.toISOString(), stake: 4, book: "Paddy Power" } });
  const open = mk({ id: "o", result: null, placed: { at: NOW.toISOString(), stake: 5, book: "Betfair" } });
  const notPlaced = mk({ id: "n", result: null, placed: null });
  const done = mk({ id: "d", result: "won", odds: 2, placed: null });
  assert.deepEqual(placedSummary([won, lost, open, notPlaced, done], new Date("2026-11-22T09:00:00Z")), { bets: 3, staked: 19, settled: 2, profit: 16, toPlace: 1 });
});

test("notifications are focused: TipMan, the scheduled summaries and safety warnings get through; strategy chatter is muted and logged", async () => {
  assert.equal(pushKind({ title: "TipMan Premium: Trixie, 4pt: send to bet?", tag: "tipman-tg1-group" }), "tipman");
  assert.equal(pushKind({ title: "New tip: TipMan InPlays & Rollers", tag: "tip-1-2" }), "tipman");
  assert.equal(pushKind({ title: "GoalBrew 14:00: Live -£3.87 today", tag: "summary-14" }), "summary");
  assert.equal(pushKind({ title: "Sunday review", tag: "weekly-review" }), "summary");
  assert.equal(pushKind({ title: "Daily loss stop", tag: "loss-stop" }), "safety");
  assert.equal(pushKind({ title: "Not placed: LAY next goal", tag: "unplaced-12" }), "safety");
  assert.equal(pushKind({ title: "Betting paused: Betfair problem" }), "safety");
  assert.equal(pushKind({ title: "Telegram alerts are back", tag: "telegram-watchdog" }), "safety");
  for (const [title, tag] of [["Golden alert · Time To Fight", "golden-1"], ["Strategy suggestion", "strategy-advice"], ["Won +£0.50", "bet-result-3"], ["Auto-adjust: 2 changes", "auto-adjust"], ["League check: 2 milestones", "league-milestones"], ["Golden stage lost", "golden-stage-x"], ["Stake raised: OG 2 SHG", "stake-auto-og"], ["15 bets settled: -£10.82", "bet-results"]] as const) {
    assert.equal(pushKind({ title, tag }), "other", title);
  }
  const db = new EngineDb(":memory:", () => {});
  assert.equal(pushFocused(db), true, "focused by default");
  await sendPush(db, { title: "Strategy suggestion", body: "x", tag: "strategy-advice" });
  await sendPush(db, { title: "TipMan Premium: Acca, 3pt: send to bet?", body: "y", tag: "tipman-1" });
  const logged = db.listPushLog(5).map((n) => n.title).sort();
  assert.deepEqual(logged, ["(muted) Strategy suggestion", "TipMan Premium: Acca, 3pt: send to bet?"]);
  setPushFocused(db, false);
  await sendPush(db, { title: "Strategy suggestion", body: "x", tag: "strategy-advice" });
  assert.ok(db.listPushLog(5).some((n) => n.title === "Strategy suggestion"), "switched off: everything is sent again");
});
