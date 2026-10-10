/**
 * Laying (Away Win Lay): GoalBrew lays the away side in Match Odds, the stake being the liability. Only through its own
 * direct betting, never the CSV feed; never above the maximum lay price; never over the liability.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { askLayPrice, layStake, runDirect, saveDirectSettings, tickAtOrBelow, type Book, type PlaceResult, type RefOrder, type Trading } from "../src/betfair/direct";
import { priceResult } from "../src/server/pricing";

const ENV = { BF_APP_KEY: "k", BF_USERNAME: "u", BF_PASSWORD: "p", BF_CERT_PEM: "c", BF_KEY_PEM: "k", BF_DIRECT_BETTING: "allow" } as NodeJS.ProcessEnv;
const ALERT = ["🔔 Away Win Lay", "", "🏴 Scotland Championship", "Raith vs Queen's Park", "", "⌛ Kickoff: In 1 hour", "", "1X2 Pre-Match Odds:", "1.85 3.60 4.50"].join("\n");

class FakeBetfair implements Trading {
  awayBack = 4.4;
  awayLay: number | null = 4.5;
  placed: Array<{ price: number; size: number; side: string }> = [];
  orders: RefOrder[] = [];
  async market() {
    return { marketId: "1.2", runners: [{ selectionId: 1, runnerName: "Raith" }, { selectionId: 2, runnerName: "The Draw" }, { selectionId: 3, runnerName: "Queens Park" }] };
  }
  async book(): Promise<Book> {
    return {
      status: "OPEN",
      inplay: false,
      runners: [
        { selectionId: 1, status: "ACTIVE", back: 1.85, lay: 1.87 },
        { selectionId: 2, status: "ACTIVE", back: 3.6, lay: 3.7 },
        { selectionId: 3, status: "ACTIVE", back: this.awayBack, lay: this.awayLay, layDepth: this.awayLay ? [{ price: this.awayLay, size: 50 }] : [] },
      ],
    };
  }
  async ordersByRef(refs: string[]) {
    return this.orders.filter((o) => refs.includes(o.customerOrderRef ?? ""));
  }
  async ordersById(ids: string[]) {
    return this.orders.filter((o) => ids.includes(o.betId));
  }
  async place(o: { marketId: string; selectionId: number; price: number; size: number; ref: string; side?: "BACK" | "LAY" }): Promise<PlaceResult> {
    this.placed.push({ price: o.price, size: o.size, side: o.side ?? "BACK" });
    const order: RefOrder = { betId: `B${this.placed.length}`, marketId: o.marketId, selectionId: o.selectionId, side: o.side ?? "BACK", status: "EXECUTION_COMPLETE", sizeMatched: o.size, sizeRemaining: 0, averagePriceMatched: o.price, customerOrderRef: o.ref };
    this.orders.push(order);
    return { ok: true, betId: order.betId, sizeMatched: o.size, avgPrice: o.price };
  }
  async cancel() {
    return 0;
  }
}

function setup(opts: { liability?: number; maxLay?: number } = {}) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, {
    enabled: true,
    stakes: { "away win lay": opts.liability ?? 5 },
    strategies: { "away win lay": true },
    ...(opts.maxLay ? { maxLayOdds: { "away win lay": opts.maxLay } } : {}),
  });
  saveDirectSettings(db, { mode: "live" }, new Date(Date.now() - 60_000), ENV);
  db.upsertLivePick("chat", 1, ALERT, parseAlert(ALERT), new Date().toISOString());
  const id = db.listLivePicks(1)[0]!.id;
  db.setPickExchange(id, "on", "Raith v Queens Park", 4.4, null, "E1");
  return { db, id, bf: new FakeBetfair() };
}

test("the lay maths: a liability is never exceeded, and prices sit on Betfair's steps", () => {
  assert.equal(tickAtOrBelow(4.725), 4.7);
  assert.equal(askLayPrice(4.5, 6, 5), 4.7);
  assert.equal(askLayPrice(4.5, 4.6, 5), 4.6, "never above the maximum lay price");
  assert.equal(layStake(5, 4.7), 1.35); // 1.35 x 3.7 = £4.995 liability, under £5
});

test("an Away Win Lay pick is LAID on the away side through direct betting, the stake being the liability", async () => {
  const { db, id, bf } = setup({ maxLay: 6 });
  await runDirect(db, bf, new Date(), ENV);
  assert.deepEqual(bf.placed, [{ price: 4.7, size: 1.35, side: "LAY" }]);
  assert.equal(db.getDirectBet(id)!.state, "placed");
});

test("a lay is never handed to the CSV feed for other betting software", () => {
  const { db } = setup();
  const feed = buildFeed(db, { markSent: true });
  assert.equal(feed.newlySent, 0);
  assert.ok(feed.skipped.some((s) => /only by GoalBrew's direct betting/.test(s.reason)));
});

test("above the maximum lay price it waits instead of laying", async () => {
  const { db, id, bf } = setup({ maxLay: 4 });
  db.setPickExchangeOdds(id, 3.9); // the feed's own check passes; Betfair's lay price is the higher 4.50
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(bf.placed.length, 0);
  assert.match(db.getDirectBet(id)!.reason ?? "", /above the maximum/);
});

test("a liability too small for Betfair's £1 minimum lay is refused with what to raise it to", async () => {
  const { db, id, bf } = setup({ liability: 2 });
  await runDirect(db, bf, new Date(), ENV);
  assert.equal(bf.placed.length, 0);
  const d = db.getDirectBet(id)!;
  assert.equal(d.state, "failed");
  assert.match(d.reason ?? "", /raise the liability/);
});

test("a matched lay is counted as its liability, with back-equivalent odds", () => {
  const won = priceResult(
    { market: "AWAY_WIN_LAY", result: "hit", targetLine: null, overLine: null, overOdds: null, favouriteOdds: null, sent: true, sentStake: 5, sim: null, placement: "betfair", betStake: 1.35, betOdds: 4.7, betProfit: 1.35 } as never,
    { strategyStake: 5, assumedOdds: null, commission: 0.02 },
  );
  assert.equal(won.kind, "priced");
  if (won.kind === "priced") {
    assert.ok(Math.abs(won.stake - 4.995) < 1e-9);
    assert.ok(Math.abs(won.profit - 1.35 * 0.98) < 1e-9);
  }
});
