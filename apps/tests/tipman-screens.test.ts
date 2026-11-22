/** TipMan's Telegram screenshots: the caption's staking, the bets built from the selections, and the reading of the image reply. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { buildScreenCards, combinations, notifyScreenPost, parseStakePlan, parseVision, visionPrompt, type VisionRead } from "../src/tips/tipman-screens";
import { listCards, setLegResultByHand, storeCards } from "../src/tips/tipman-cards";

const NOW = new Date("2026-11-22T10:00:00Z");
const CAPTION = "Premium Bookings\n\nBest price in screenshot ⬆️\n\n1pt for all 3 doubles and a 1pt treble (4pt total)\n\nBetfair - add to betslip \nPaddy - add to betslip";
const LINKS = [
  { label: "Betfair - add to betslip", url: "https://media.betfair.com/redirect.aspx?pid=17720663&bid=1615&redirectURL=x" },
  { label: "Paddy - add to betslip", url: "https://media.paddypower.com/redirect.aspx?pid=17720662" },
];
const sel = (match: string, selection: string, odds: string, kickoff = "22 Nov 15:00") => ({ match, league: "Premier League", kickoff, selection, market: "Player to be carded", odds });
const READ: VisionRead = {
  kind: "selections",
  selections: [sel("Wolves v Burnley", "Heskey to be carded", "5/2"), sel("Everton v Fulham", "Gueye to be carded", "11/4"), sel("Spurs v Chelsea", "Romero to be carded", "7/2")],
  totalOdds: "",
  stake: "",
  confidence: "high",
  notes: "",
};

test("the caption's staking: three doubles and a treble, a total, and the other ways of saying it", () => {
  assert.deepEqual(parseStakePlan(CAPTION), { parts: [{ shape: "double", pts: 1 }, { shape: "treble", pts: 1 }], totalPts: 4 });
  assert.deepEqual(parseStakePlan("1pt Trixie").parts, [{ shape: "double", pts: 1 }, { shape: "treble", pts: 1 }]);
  assert.deepEqual(parseStakePlan("2pts treble").parts, [{ shape: "treble", pts: 2 }]);
  assert.deepEqual(parseStakePlan("0.5 point acca and 1pt single").parts, [{ shape: "acca", pts: 0.5 }, { shape: "single", pts: 1 }]);
  assert.deepEqual(parseStakePlan("Premium Bet Builder\nBest price and stake in the screenshots"), { parts: [], totalPts: null });
  assert.equal(parseStakePlan("Total 6pts across them").totalPts, 6);
});

test("combinations of selections", () => {
  assert.deepEqual(combinations(["a", "b", "c"], 2), [["a", "b"], ["a", "c"], ["b", "c"]]);
  assert.deepEqual(combinations(["a", "b", "c"], 3), [["a", "b", "c"]]);
  assert.deepEqual(combinations(["a"], 2), []);
});

test("the Premium Bookings post: three selections make a Trixie of four bets, 4pt, each at the product of its legs", () => {
  const cards = buildScreenCards({ messageId: 9001, caption: CAPTION, read: READ, links: LINKS, now: NOW });
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((c) => c.name), ["Booking Bets · double", "Booking Bets · double", "Booking Bets · double", "Booking Bets · treble"]);
  assert.deepEqual(cards.map((c) => c.pts), [1, 1, 1, 1]);
  assert.deepEqual(cards.map((c) => c.odds), [13.13, 15.75, 16.88, 59.06], "3.5 x 3.75, 3.5 x 4.5, 3.75 x 4.5 and all three");
  assert.deepEqual(cards.map((c) => c.legs.length), [2, 2, 2, 3]);
  assert.deepEqual(cards[0]!.group, { id: "tg9001-group", label: "Trixie", totalPts: 4, bets: 4 }, "the caption's 4pt total matches, so no warning");
  assert.match(cards[0]!.note ?? "", /couldn't be split/, "this test's Paddy link has no legs to split, and the card says so");
  assert.ok(cards.every((c) => c.tier === "premium" && c.category === "booking" && c.source === "screenshot" && !c.ptsAssumed));
  assert.ok(cards.every((c) => c.legs.every((l) => l.settle === "manual")), "bookings aren't on the Exchange");
  assert.equal(cards[0]!.books[0]!.book, "Betfair", "links that can't be split are kept as the post gave them");
  assert.equal(cards[0]!.day, "2026-11-22");
});

test("a caption whose total doesn't match the selections is flagged, not trusted", () => {
  const two = { ...READ, selections: READ.selections.slice(0, 2) };
  const cards = buildScreenCards({ messageId: 9002, caption: CAPTION, read: two, links: LINKS, now: NOW });
  assert.equal(cards.length, 1, "two selections: one double and no treble");
  assert.match(cards[0]!.note ?? "", /4pt in total but these selections make 1pt/);
});

test("a price the reader couldn't read leaves the combined price empty and says so", () => {
  const blurred = { ...READ, confidence: "low" as const, selections: [sel("A v B", "A to win", "5/2"), sel("C v D", "C to win", "")] };
  const [card] = buildScreenCards({ messageId: 9003, caption: "Premium Double\n1pt double", read: blurred, links: [], now: NOW });
  assert.equal(card!.odds, null);
  assert.match(card!.note ?? "", /wasn't sure/);
  assert.match(card!.note ?? "", /price couldn't be read/);
});

test("a bet builder: all selections in one match are one bet at the price shown, its stake from the image", () => {
  const read: VisionRead = { kind: "selections", selections: [sel("Liverpool v Man Utd", "BTTS - Yes", "53/100"), sel("Liverpool v Man Utd", "Over 2.5 Goals", "1/2"), sel("Liverpool v Man Utd", "Over 2.5 Cards", "4/25")], totalOdds: "1.26/1", stake: "2pts", confidence: "high", notes: "" };
  const cards = buildScreenCards({ messageId: 9004, caption: "Premium Bet Builder\n\nBest price and stake in the screenshots", read, links: LINKS, now: NOW });
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0]!.category, cards[0]!.pts, cards[0]!.ptsAssumed, cards[0]!.odds, cards[0]!.legs.length], ["bet-builder", 2, false, 2.26, 3]);
  assert.equal(cards[0]!.group, undefined);
});

test("a single selection with no staking in the caption is one bet at 1pt, marked as assumed; not-a-bet images build nothing", () => {
  const read: VisionRead = { ...READ, selections: [sel("A v B", "A to win", "2/1")] };
  const [one] = buildScreenCards({ messageId: 9005, caption: "Premium BOTD", read, links: [], now: NOW });
  assert.deepEqual([one!.category, one!.pts, one!.ptsAssumed, one!.odds, one!.legs[0]!.settle], ["botd", 1, true, 3, "exchange"]);
  assert.deepEqual(buildScreenCards({ messageId: 9006, caption: "Another winner", read: { ...READ, kind: "other", selections: [] }, links: [], now: NOW }), []);
});

test("the image reply is read as JSON, whatever surrounds it, and junk is refused", () => {
  const reply = 'Here you go:\n```json\n{"kind":"selections","selections":[{"match":"Wolves v Burnley","league":"","kickoff":"","selection":"Heskey to be carded","market":"Player to be carded","odds":"5/2"},{"selection":""}],"totalOdds":"","stake":"","confidence":"low","notes":"crop"}\n```';
  const r = parseVision(reply)!;
  assert.equal(r.kind, "selections");
  assert.equal(r.selections.length, 1, "an empty selection is dropped");
  assert.equal(r.confidence, "low");
  assert.equal(parseVision("I can't see an image."), null);
  assert.equal(parseVision("{not json}"), null);
  assert.equal(parseVision('{"kind":"selections","selections":[]}')!.kind, "other", "no selections is not a bet");
  assert.match(visionPrompt(CAPTION), /Premium Bookings/);
});

test("a leg marked by hand updates every bet it is in: a Trixie from three taps", () => {
  const db = new EngineDb(":memory:", () => {});
  const stored = storeCards(db, buildScreenCards({ messageId: 9001, caption: CAPTION, read: READ, links: LINKS, now: NOW }));
  assert.equal(stored.length, 4);
  assert.equal(storeCards(db, stored).length, 0, "the same post again adds nothing");
  // Heskey is not booked, Gueye and Romero are: the double of those two wins, the other two doubles and the treble lose.
  assert.equal(setLegResultByHand(db, "Wolves v Burnley", "Heskey to be carded", "lost", NOW), 3, "in two doubles and the treble");
  setLegResultByHand(db, "Everton v Fulham", "Gueye to be carded", "won", NOW);
  setLegResultByHand(db, "Spurs v Chelsea", "Romero to be carded", "won", NOW);
  const byName = listCards(db, "2026-11-22").map((c) => [c.legs.map((l) => l.selection.split(" ")[0]).join("+"), c.result]);
  assert.deepEqual(byName.sort(), [["Gueye+Romero", "won"], ["Heskey+Gueye+Romero", "lost"], ["Heskey+Gueye", "lost"], ["Heskey+Romero", "lost"]]);
});


// ---------------------------------------------------------------------------- Paddy Power, one link per bet

import { paddyLinkFor, paddyParts } from "../src/tips/tipman-screens";

// TipMan's real Paddy Power link for the free accumulator of 22 Nov 2026: four legs.
const PP4 =
  "https://media.paddypower.com/redirect.aspx?pid=17720662&bid=1524&redirectURL=https%3A%2F%2Fpaddypower.com/?action=addLegs&leg%3D927.414659489%7C18567%7CSIMPLE_SELECTION%7C%26leg%3D927.414660894%7C199545%7CSIMPLE_SELECTION%7C%26leg%3D927.414733141%7C5168454%7CSIMPLE_SELECTION%7C%26leg%3D927.414737964%7C52457652%7CSIMPLE_SELECTION%7C&lpid=53";
const PP3 = PP4.replace("%26leg%3D927.414737964%7C52457652%7CSIMPLE_SELECTION%7C", "");

test("a Paddy Power link comes apart into its legs, and goes back together with only the ones asked for, in the same form", () => {
  const p = paddyParts(PP4)!;
  assert.equal(p.legs.length, 4);
  assert.equal(p.suffix, "&lpid=53");
  assert.equal(`${p.prefix}${p.legs.join("%26")}${p.suffix}`, PP4, "whole again, byte for byte");
  const two = paddyLinkFor(PP4, [0, 2])!;
  assert.equal(two, PP4.replace("%26leg%3D927.414660894%7C199545%7CSIMPLE_SELECTION%7C", "").replace("%26leg%3D927.414737964%7C52457652%7CSIMPLE_SELECTION%7C", ""));
  assert.ok(two.includes("18567") && two.includes("5168454") && !two.includes("199545") && !two.includes("52457652"));
  assert.equal(paddyLinkFor(PP4, [4]), null, "no such leg");
  assert.equal(paddyLinkFor(PP4, []), null);
  assert.equal(paddyLinkFor("https://media.betfair.com/redirect.aspx?bssId%3D1%2C2", [0]), null, "not a Paddy Power link");
  assert.equal(paddyParts("https://example.com/"), null);
});

test("the Trixie gets a Paddy Power link for each double and the treble, each holding only its own legs", () => {
  const links = [{ label: "Betfair - add to betslip", url: LINKS[0]!.url }, { label: "Paddy - add to betslip", url: PP3 }];
  const cards = buildScreenCards({ messageId: 9010, caption: CAPTION, read: READ, links, now: NOW });
  assert.equal(cards.length, 4);
  const has = (c: (typeof cards)[number], ...ids: string[]) => ids.every((i) => c.pad!.includes(i));
  // Selections read in order: Heskey (18567), Gueye (199545), Romero (5168454).
  assert.ok(has(cards[0]!, "18567", "199545") && !cards[0]!.pad!.includes("5168454"), "double 1: Heskey + Gueye");
  assert.ok(has(cards[1]!, "18567", "5168454") && !cards[1]!.pad!.includes("199545"), "double 2: Heskey + Romero");
  assert.ok(has(cards[2]!, "199545", "5168454") && !cards[2]!.pad!.includes("18567"), "double 3: Gueye + Romero");
  assert.ok(has(cards[3]!, "18567", "199545", "5168454"), "the treble: all three");
  assert.equal(cards[3]!.pad, PP3);
  assert.deepEqual(cards.map((c) => c.books.map((b) => b.book)), [["Paddy Power"], ["Paddy Power"], ["Paddy Power"], ["Paddy Power"]], "only the link that holds exactly this bet is kept");
  assert.equal(cards[0]!.note, undefined);
});

test("a link with a different number of legs from the selections read is not split, and the card says so", () => {
  const links = [{ label: "Paddy - add to betslip", url: PP4 }];
  const cards = buildScreenCards({ messageId: 9011, caption: CAPTION, read: READ, links, now: NOW });
  assert.ok(cards.every((c) => c.pad === undefined));
  assert.match(cards[0]!.note ?? "", /Paddy Power's link has 4 selections but 3 were read/);
  assert.deepEqual(cards[0]!.books.map((b) => b.book), ["Paddy Power"], "the whole-post link is kept as it was");
});

test("the notification points at the bet sheet on the TipMan page, which lists each bet to open", async () => {
  const db = new EngineDb(":memory:", () => {});
  const cards = buildScreenCards({ messageId: 9012, caption: CAPTION, read: READ, links: [{ label: "Paddy", url: PP3 }], now: NOW });
  await notifyScreenPost(db, cards, []);
  const n = db.listPushLog(1)[0]!;
  assert.equal(n.url, "/more/admin/tipman#tg9012-group");
  assert.match(n.title, /Trixie, 4pt: send to bet\?/);
  assert.match(n.body, /4 bets to open in Paddy Power/);
});

// ---------------------------------------------------------------------------- the three real posts of 21 Nov 2026

const bet = (name: string, shape: "single" | "acca" | "builder" | "multiples", pts: string, price: string, selections: ReturnType<typeof sel>[]) => ({ name, shape, pts, price, selections });
const readOf = (bets: ReturnType<typeof bet>[], extra: Partial<VisionRead> = {}): VisionRead => ({ kind: "selections", selections: bets.flatMap((b) => b.selections), bets, totalOdds: "", stake: "", confidence: "high", notes: "", ...extra });

test("the bet builder post: the advised 3 points and the price shown are used, not assumed", () => {
  const legs = ["Man City to win", "Man City 2+ Goals", "E. Haaland 1+ Shots on Target", "E. Haaland to Score"].map((s) => sel("Man City v Fulham", s, "1/3"));
  const cards = buildScreenCards({ messageId: 30245, caption: "Premium Bet Builder\n\nBest price and stake in the screenshots", read: readOf([bet("Premium Bet Builder", "builder", "3 points", "4.15/1", legs)]), links: [], now: NOW });
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0]!.category, cards[0]!.pts, cards[0]!.ptsAssumed, cards[0]!.odds, cards[0]!.legs.length], ["bet-builder", 3, false, 5.15, 4]);
});

test("a cropped accumulator: the price shown wins over the legs read, and the card says legs may be missing", () => {
  const legs = [sel("Cambridge U v Stockport", "BTTS - Yes", "3/5"), sel("Mansfield v MK Dons", "BTTS - Yes", "1/2"), sel("Accrington v Salford", "BTTS - Yes", "3/5"), sel("Cheltenham v Bristol R", "BTTS - Yes", "3/5")];
  const cards = buildScreenCards({ messageId: 30244, caption: "Premium BTTS Acca\n\n3pt acca", read: readOf([bet("Premium BTTS Acca", "acca", "3pts", "6.09/1", legs)], { confidence: "low", notes: "Screenshot is cropped at the bottom." }), links: [], now: NOW });
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0]!.pts, cards[0]!.odds, cards[0]!.legs.length], [3, 7.09, 4]);
  assert.match(cards[0]!.note ?? "", /multiply to 6\.14 but the screenshot's price is 7\.09: it may be cropped/);
  assert.match(cards[0]!.note ?? "", /cropped at the bottom/);
});

test("one image with two bets: a 5pt Bet of the Day single and a 2pt accumulator are separate bets, not one big one", () => {
  const botd = bet("Bet of the Day", "single", "5pts", "4/5", [sel("Villa v Sunderland", "Villa to win", "")]);
  const acca = bet("Acca", "acca", "2pts", "5.75/1", [sel("Bayer 04 v Paderborn", "Bayer 04 to win", "2/7"), sel("Parma v Roma", "Roma to win", "1/4"), sel("Real Madrid v Celta", "Real Madrid to win", "1/6")]);
  const cards = buildScreenCards({ messageId: 30242, caption: "Premium BOTD & Acca\n\nPlease use an Early Payout bookie", read: readOf([botd, acca]), links: [], now: NOW });
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => [c.category, c.pts, c.odds, c.legs.length]), [["botd", 5, 1.8, 1], ["acca", 2, 6.75, 3]]);
  assert.deepEqual(cards[0]!.group, { id: "tg30242-group", label: "Bet of the Day + Acca", totalPts: 7, bets: 2 });
  assert.deepEqual(cards.map((c) => c.id), ["tg30242-b1-single", "tg30242-b2-acca"]);
});

test("the reply grouped into bets is read, with its stakes and prices; a flat reply still works", () => {
  const reply = JSON.stringify({ kind: "selections", bets: [{ name: "Bet of the Day", shape: "single", pts: "5pts", price: "4/5", selections: [{ match: "Villa v Sunderland", selection: "Villa to win" }] }, { name: "Acca", shape: "weird", pts: "2pts", price: "5.75/1", selections: [{ match: "A v B", selection: "A to win", odds: "1/2" }] }, { name: "empty", shape: "acca", selections: [] }], confidence: "high" });
  const r = parseVision(reply)!;
  assert.equal(r.bets!.length, 2, "a bet with no selections is dropped");
  assert.deepEqual(r.bets!.map((b) => [b.shape, b.pts, b.price]), [["single", "5pts", "4/5"], ["multiples", "2pts", "5.75/1"]], "an unknown shape is a plain list");
  assert.equal(r.selections.length, 2);
  assert.match(visionPrompt("x"), /SEVERAL separate bets/);
});
