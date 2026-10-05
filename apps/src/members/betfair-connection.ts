/**
 * A member's Betfair connection, as the Betfair Automation page shows it.
 *
 * Two kinds exist in the design:
 *   house   the GoalBrew Betfair account set up on the engine (BF_APP_KEY and login settings). Admin members only:
 *           it is the owner's own money, and Betfair's personal app keys may only bet for their owner.
 *   vendor  a member's own account. Betfair allows this only for approved Software Vendors, through Betfair's own login
 *           page (OAuth), so GoalBrew would hold an access token, never a password. Not available until Betfair approves
 *           GoalBrew; the page says so plainly. (Tokens would be stored encrypted, see secrets.ts.)
 * The connection never switches live betting on by itself: the member must do that explicitly (live.ts).
 */
import type { EngineDb } from "../storage/engine-db";
import { readCredentials } from "../betfair/exchange";
import { can } from "./permissions";
import type { MemberContext } from "./service";
import { membersStore, type BetfairConnection } from "./store";
import type { LiveDeps } from "./live";

export interface ConnectionView {
  kind: BetfairConnection["kind"];
  status: BetfairConnection["status"];
  lastTestAt: string | null;
  lastOkAt: string | null;
  /** In words for the member. */
  lastError: string | null;
  /** What this member may connect, and why not. */
  options: { house: { available: boolean; reason: string | null }; vendor: { available: boolean; reason: string } };
  account: { available: number | null; delayedKey: boolean | null } | null;
}

export const VENDOR_REASON =
  "Connecting your own Betfair account needs Betfair to approve GoalBrew as a Software Vendor. Until then, use simulation: it follows exactly the same alerts and rules.";

let lastAccount: { userId: number; available: number | null; delayedKey: boolean | null } | null = null;

export function connectionView(db: EngineDb, ctx: MemberContext, env = process.env): ConnectionView {
  const c = membersStore(db).getConnection(ctx.user.id);
  const allowed = can(ctx.access, "connectBetfair");
  const houseReason = !allowed
    ? "Betfair connections are for paid members."
    : ctx.tier !== "admin"
      ? "The GoalBrew Betfair account is for the administrator only."
      : readCredentials(env) === null
        ? "The Betfair link isn't set up on the server (BF_APP_KEY and the login settings)."
        : null;
  return {
    kind: c.kind,
    status: c.status,
    lastTestAt: c.lastTestAt,
    lastOkAt: c.lastOkAt,
    lastError: c.lastError,
    options: { house: { available: houseReason === null, reason: houseReason }, vendor: { available: false, reason: allowed ? VENDOR_REASON : "Betfair connections are for paid members." } },
    account: lastAccount && lastAccount.userId === ctx.user.id && c.kind === "house" ? { available: lastAccount.available, delayedKey: lastAccount.delayedKey } : null,
  };
}

/** Connects (kind "house") or tests the existing connection, by reading the account balance. Never places anything. */
export async function connectOrTest(db: EngineDb, ctx: MemberContext, kind: "house" | "vendor", deps: LiveDeps | null, now = new Date(), env = process.env): Promise<ConnectionView> {
  const store = membersStore(db);
  const at = now.toISOString();
  const view = connectionView(db, ctx, env);
  if (kind === "vendor") throw new Error(view.options.vendor.reason);
  if (!view.options.house.available) throw new Error(view.options.house.reason ?? "Not available.");
  const before = store.getConnection(ctx.user.id);
  let status: BetfairConnection["status"] = "error";
  let error: string | null = null;
  if (!deps) error = "The Betfair link isn't running on the server.";
  else {
    try {
      const a = await deps.account();
      lastAccount = { userId: ctx.user.id, available: a.available, delayedKey: a.delayedKey };
      status = "connected";
    } catch (err) {
      error = `Betfair didn't accept the connection: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  store.saveConnection({ userId: ctx.user.id, kind: "house", status, tokenEnc: null, lastTestAt: at, lastOkAt: status === "connected" ? at : before.lastOkAt, lastError: error }, at);
  store.audit({ at, userId: ctx.user.id, actor: "member", action: "betfair_connection", object: "house", result: status === "connected" ? "ok" : "error", detail: error });
  if (status === "connected" && before.status !== "connected") store.event(ctx.user.id, "betfair_connected", { kind: "house" }, at);
  if (status !== "connected") store.notify({ userId: ctx.user.id, at, kind: "betfair_error", title: "Betfair connection failed", body: error ?? "Unknown error.", link: "/members/automation" });
  return connectionView(db, ctx, env);
}

/** Disconnects: live betting goes off too. */
export function disconnect(db: EngineDb, ctx: MemberContext, now = new Date()): void {
  const store = membersStore(db);
  const at = now.toISOString();
  store.saveConnection({ userId: ctx.user.id, kind: "none", status: "disconnected", tokenEnc: null, lastTestAt: null, lastOkAt: null, lastError: null }, at);
  store.updateMember(ctx.user.id, { liveEnabled: false }, at);
  store.liveFollowsToSim(ctx.user.id, at);
  store.audit({ at, userId: ctx.user.id, actor: "member", action: "betfair_disconnect", object: null, result: "ok", detail: null });
}
