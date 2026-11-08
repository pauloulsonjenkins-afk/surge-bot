import { NextResponse } from "next/server";
import { AGENT_KEY_HEADER, agentKeyValid } from "@/server/agent-key";
import { fetchAdminStrategies, fetchAgentDates, fetchLeagueForm, fetchLivePicks, fetchToday, fetchWinLoss, parsePickMode, toTradeLogPick } from "@/server/engine-client";

/**
 * Read-only figures for the AI agents (see src/server/agent-key.ts). GET only: Next answers 405 to any other method,
 * so the agent key can never change a setting, a stake, Live/Sim or a bet. Each view is the same figure the admin's own
 * page reads:
 *   /api/agent/today                     the Today page
 *   /api/agent/winloss?mode=live|sim|all  Win/Loss
 *   /api/agent/strategies[?since=ISO]    Strategies
 *   /api/agent/live[?limit=1..200]       the latest picks, as the Trade Log shows them
 *   /api/agent/dates                     Live/Sim and slice switch dates, rule changes, stake-ladder history, locks
 *   /api/agent/leagues                   each strategy's verdict in each league, and the league-filter backtest
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIEWS = ["today", "winloss", "strategies", "live", "dates", "leagues"] as const;
type View = (typeof VIEWS)[number];

async function read(view: View, params: URLSearchParams): Promise<unknown> {
  switch (view) {
    case "today":
      return fetchToday();
    case "winloss":
      return fetchWinLoss(parsePickMode(params.get("mode")));
    case "strategies": {
      const raw = params.get("since");
      return fetchAdminStrategies(raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null);
    }
    case "dates":
      return fetchAgentDates();
    case "leagues":
      return fetchLeagueForm();
    case "live": {
      const n = Number(params.get("limit"));
      const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 200) : 200;
      return { picks: (await fetchLivePicks(limit, null)).map(toTradeLogPick) };
    }
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ view: string }> }) {
  if (!agentKeyValid(request.headers.get(AGENT_KEY_HEADER))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { view } = await ctx.params;
  if (!(VIEWS as readonly string[]).includes(view)) return NextResponse.json({ error: "not_found", views: VIEWS }, { status: 404 });
  try {
    return NextResponse.json(await read(view as View, new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
