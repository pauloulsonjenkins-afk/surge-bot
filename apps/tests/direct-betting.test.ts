/**
 * Direct betting (betfair/direct.ts): GoalBrew placing bets on Betfair itself. Betfair is a fake here; what matters is
 * that a pick is placed once at most, only when every check passes, and that Shadow never places anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { directIsLive, getDirectSettings, overroundOf, runDirect, saveDirectSettings, type Book, type PlaceResult, type RefOrder, type Trading } from "../src/betfair/direct";
import { alertTextFrom, useWebhookAlert } from "../src/inplayguru/receiver";

const ENV = { BF_APP_KEY: "k", BF_USERNAME: "u", BF_PASSWORD: "p", BF_CERT_PEM: "c", BF_KEY_PEM: "k", BF_DIRECT_BETTING: "allow" } as NodeJS.ProcessEnv;
const LOCKED = { ...ENV, BF_DIRECT_BETTING: "" } as NodeJS.ProcessEnv;

function alert(home = "Lyon", away = "Nice"): string {
  return ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `${home} vs ${away}`, "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
}

class FakeBetfair implements Trading {
  back = 1.8;
  lay: number | null = 1.85;
  status = "OPEN";
  placed: Array<{ price: number; size: number; ref: string }> = [];
  orders: RefOrder[] = [];
  placeFails: "timeout" | string | null = null;
  matchedOnPlace = 2;
  cancelled: string[] = [];

  async market() {
    return { marketId: "1.1", runners: [{ selectionId: 1, runnerName: "Over 1.5 Goals" }, { selectionId: 2, runnerName: "Under 1.5 Goals" }] };
  }
  async book(): Promise<Book> {
    return { status: this.status, inplay: true, runners: [{ selectionId: 1, status: "ACTIVE", back: this.back, lay: this.lay }, { selectionId: 2, status: "ACTIVE", back: 2.1, lay: 2.14 }] };
  }
  async ordersByRef(refs: string[]) {
    return this.orders.filter((o) => refs.includes(o.customerOrderRef ?? ""));
  }
  async ordersById(ids: string[]) {
    return this.orders.filter((o) => ids.includes(o.betId));
  }
  async place(o: { marketId: string; selectionId: number; price: number; size: number; ref: string }): Promise<PlaceResult> {
    this.placed.push({ price: o.price, size: o.size, ref: o.ref });
    const order: RefOrder = {
      betId: `B${this.placed.length}`, marketId: o.marketId, selectionId: o.selectionId, side: "BACK",
      status: this.matchedOnPlace >= o.size ? "EXECUTION_COMPLETE" : "EXECUTABLE",
      sizeMatched: this.matchedOnPlace, sizeRemaining: o.size - this.matchedOnPlace, averagePriceMatched: o.price, customerOrderRef: o.ref,
    };
    if (this.placeFails === "timeout") {
      this.orders.push(order);
      throw new Error("Betfair did not answer within 20 seconds.");
    }
    if (this.placeFails) return { ok: false, code: this.placeFails };
    this.orders.push(order);
    return { ok: true, betId: order.betId, sizeMatched: this.matchedOnPlace, avgPrice: o.price };
  }
  async cancel(_m: string, betId: string) {
    this.cancelled.push(betId);
    const o = this.orders.find((x) => x.betId === betId)!;
    const left = o.sizeRemaining ?? 0;
    o.sizeRemaining = 0;
    o.status = "EXECUTION_COMPLETE";
    return left;
  }
}

function setup(mode: "shadow" | "live", opts: { minOdds?: number; env?: NodeJS.ProcessEnv; dailyStakeLimit?: number } = {}) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, {
    enabled: true,
    stakes: { "blistering momentum": 2 },
    strategies: { "blistering momentum": true },
    ...(opts.minOdds ? { minOdds: { "blistering momentum": opts.minOdds } } : {}),
  });
  saveDirectSettings(db, { mode, ...(opts.dailyStakeLimit ? { dailyStakeLimit: opts.dailyStakeLimit } : {}) }, new Date(Date.now() - 60_000), opts.env ?? ENV);
  let n = 1;
  const add = (home?: string, away?: string) => {
    const text = alert(home, away);
    db.upsertLivePick("chat", n++, text, parseAlert(text), new Date().toISOString());
    const id = db.listLivePicks(1)[0]!.id;
    db.setPickExchange(id, "on", `${home ?? "Lyon"} v ${away ?? "Nice"}`, 1.8, null, "E1");
    return id;
  };
  return { db, add, bf: new FakeBetfair() };
}

test("Shadow records what it would bet and never places; BF Bot Manager's feed carries on", async () => {
  const { db, add, bf } = setup("shadow");
  const id = add();
  assert.equal(buildFeed(db, { markSent: true }).newlySent, 1, "the feed still hands the pick over");
  await runDirect(db, bf, new Date(), ENV);
  const d = db.getDirectBet(id)!;
  assert.equal(d.state, "shadow");
  assert.match(d.reason ?? "", /Would back £2.00 at 1.80/);
  assert.equal(bf.placed.length, 0);
  assert.equal(directIsLive(db, ENV), false);
});

test("Live places a pick once, with its own reference, and the CSV feed hands over nothing", async () => {
  const { db, add, bf } = setup("live");
  const id = add();
  await runDirect(db, bf, new Date(), ENV);
  await runDirect(db, bf, new Date(), ENV);
  assert.deepEqual(bf.placed, [{ price: 1.8, size: 2, ref: `GB${id}` }]);
  const d = db.getDirectBet(id)!;
  assert.equal(d.state, "placed");
  assert.equal(d.betId, "B1");
  assert.equal(directIsLive(db, ENV), true);
});

test("Live is locked until the engine allows it, and acts as Shadow if the lock comes back", async () => {
  const db = new EngineDb(":memory:", () => {});
  assert.throws(() => saveDirectSettings(db, { mode: "live" }, new Date(), LOCKED), /locked/);
  const { db: db2, add, bf } = setup("live");
  add();
  await runDirect(db2, bf, new Date(), LOCKED);
  assert.equal(bf.placed.length, 0);
  assert.equal(directIsLive(db2, LOCKED), false);
});

test("a wide back/lay gap or a price under the minimum waits, and the bet goes once it's right", async () => {
  const { db, add, bf } = setup("live", { minOdds: 1.7 });
  const id = add();
  bf.lay = 2.4;
  await runDirect(db, bf, new Date(), ENV);
  assert.match(db.getDirectBet(id)!.reason ?? "", /apart \(limit 15%\)/);
  bf.lay = 1.85;
  bf.back = 1.6;
  await runDirect(db, bf, new Date(), ENV);
  assert.match(db.getDirectBet(id)!.reason ?? "", /below the minimum 1.70/);
  assert.equal(bf.placed.length, 0);
  bf.back = 1.75;
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(bf.placed.length, 1);
  assert.equal(bf.placed[0]!.price, 1.75);
});

test("a suspended market waits; a refusal that isn't worth retrying fails without another try", async () => {
  const { db, add, bf } = setup("live");
  const id = add();
  bf.status = "SUSPENDED";
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(db.getDirectBet(id)!.state, "waiting");
  bf.status = "OPEN";
  bf.placeFails = "INSUFFICIENT_FUNDS";
  await runDirect(db, bf, new Date(), ENV);
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(db.getDirectBet(id)!.state, "failed");
  assert.match(db.getDirectBet(id)!.reason ?? "", /Not enough money/);
  assert.equal(bf.placed.length, 1);
});

test("no answer from Betfair: it's never sent again, Betfair's order list settles it", async () => {
  const { db, add, bf } = setup("live");
  const id = add();
  bf.placeFails = "timeout";
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(db.getDirectBet(id)!.state, "placing");
  bf.placeFails = null;
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(db.getDirectBet(id)!.state, "placed");
  assert.equal(bf.placed.length, 1);
});

test("an order already on Betfair with the pick's reference is taken over, not placed again", async () => {
  const { db, add, bf } = setup("live");
  const id = add();
  bf.orders.push({ betId: "OLD", marketId: "1.1", selectionId: 1, side: "BACK", status: "EXECUTION_COMPLETE", sizeMatched: 2, customerOrderRef: `GB${id}` });
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(bf.placed.length, 0);
  assert.equal(db.getDirectBet(id)!.betId, "OLD");
});

test("the daily stake limit stops new bets", async () => {
  const { db, add, bf } = setup("live", { dailyStakeLimit: 3 });
  const a = add("Lyon", "Nice");
  const b = add("Lens", "Brest");
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(db.getDirectBet(a)!.state, "placed");
  assert.equal(db.getDirectBet(b)!.state, "skipped");
  assert.match(db.getDirectBet(b)!.reason ?? "", /Daily stake limit/);
});

test("unmatched stake is cancelled after the set time", async () => {
  const { db, add, bf } = setup("live");
  const id = add();
  bf.matchedOnPlace = 0.5;
  await runDirect(db, bf, new Date(), ENV);
  await runDirect(db, bf, new Date(Date.now() + 30_000), ENV);
  assert.equal(bf.cancelled.length, 0);
  await runDirect(db, bf, new Date(Date.now() + 130_000), ENV);
  assert.deepEqual(bf.cancelled, ["B1"]);
  const d = db.getDirectBet(id)!;
  assert.equal(d.cancelled, 1.5);
  assert.match(d.reason ?? "", /£1.50 not matched within 120 s/);
  assert.equal(db.listOpenDirectBets().length, 0);
});

test("leaving Live stops a waiting pick; picks handed over before the mode changed aren't taken", async () => {
  const { db, add, bf } = setup("live");
  const id = add();
  bf.status = "SUSPENDED";
  await runDirect(db, bf, new Date(), ENV);
  saveDirectSettings(db, { mode: "shadow" }, new Date(), ENV);
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(db.getDirectBet(id)!.state, "skipped");

  // A pick the feed gave BF Bot Manager before Live was switched on is left alone.
  const { db: db2, add: add2, bf: bf2 } = setup("shadow");
  saveDirectSettings(db2, { mode: "off" }, new Date(), ENV);
  const old = add2();
  buildFeed(db2, { markSent: true });
  saveDirectSettings(db2, { mode: "live" }, new Date(Date.now() + 1000), ENV);
  await runDirect(db2, bf2, new Date(), ENV);
  assert.equal(db2.getDirectBet(old), null);
  assert.equal(bf2.placed.length, 0);
});

test("settings: defaults match BF Bot Manager's, and a mode change restarts the start time", () => {
  const db = new EngineDb(":memory:", () => {});
  const s = getDirectSettings(db);
  assert.equal(s.mode, "off");
  assert.equal(s.maxSpreadPct, 15);
  assert.equal(s.strategyLimits["time to fight"]?.maxOverround, 140);
  const at = new Date("2026-10-04T10:00:00Z");
  assert.equal(saveDirectSettings(db, { mode: "shadow" }, at, ENV).since, at.toISOString());
  assert.equal(saveDirectSettings(db, { maxSpreadPct: 20 }, new Date(), ENV).since, at.toISOString());
});

test("overround: summed over the selections, halved for Double Chance", () => {
  const book = (backs: number[]): Book => ({ status: "OPEN", inplay: true, runners: backs.map((b, i) => ({ selectionId: i, status: "ACTIVE", back: b, lay: null })) });
  assert.equal(overroundOf(book([1.8, 2.1]), "OVER_UNDER_15"), 103.2);
  assert.equal(overroundOf(book([1.25, 1.3, 2.5]), "DOUBLE_CHANCE"), 98.5);
  assert.equal(overroundOf({ ...book([1.8]), runners: [{ selectionId: 1, status: "ACTIVE", back: 1.8, lay: null }, { selectionId: 2, status: "ACTIVE", back: null, lay: null }] }, "X"), null);
});

test("webhook alerts: the alert is found in any JSON shape, and the same alert from Telegram is kept once", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = alert();
  assert.equal(alertTextFrom(JSON.stringify({ data: { message: { text } }, id: 7 })), text);
  assert.equal(alertTextFrom(text), text);
  assert.equal(alertTextFrom(JSON.stringify({ hello: "world" })), null);

  assert.equal(useWebhookAlert(db, JSON.stringify({ text }), "a".repeat(64)), "added");
  assert.equal(db.listLivePicks(5).length, 1);
  // Telegram's copy arrives: it takes the webhook pick over rather than adding another.
  const parsed = parseAlert(text);
  const twin = db.findTwinPick(parsed.strategyRaw, parsed.home!, parsed.away!, [parsed.goalsHome, parsed.goalsAway], new Date().toISOString(), "webhook");
  assert.ok(twin);
  db.rekeyLivePick(twin.id, "chat", 99);
  db.upsertLivePick("chat", 99, text, parsed, new Date().toISOString());
  assert.equal(db.listLivePicks(5).length, 1);
  // And a webhook after Telegram is left to Telegram's pick.
  assert.equal(useWebhookAlert(db, JSON.stringify({ text, at: 2 }), "b".repeat(64)), "alreadyFromTelegram");
  assert.equal(db.listLivePicks(5).length, 1);
});
