import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { engineUnavailable } from "@/server/public-error";
import { fetchHitRateStats, parsePickMode } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { dataGate } from "@/server/access";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";

// Open to the admin, to anyone while the public view switch is on, and to signed-in users given this page. These are totals only (hit rates by strategy, league, day and minute).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = await dataGate("dashboard");
  if (blocked) return blocked;
  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 3650) : null;

  // An explicit start ("Today" = UK midnight) takes the place of days back.
  const sinceRaw = searchParams.get("since");
  const since = sinceRaw && Number.isFinite(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  const strategy = searchParams.get("strategy")?.trim().slice(0, 120) || null;
  // Live / simulation shows which picks were actually bet, so only the admin can split by it; everyone else sees every alert.
  const admin = await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
  const asked = parsePickMode(searchParams.get("mode"));
  const mode = asked !== "all" && admin ? asked : "all";

  try {
    const stats = await cached(`stats:${since ?? days}:${strategy ?? ""}:${mode}`, 5000, () => fetchHitRateStats(days, strategy, mode, since));
    // Return, profit and stakes are money figures, so only the admin sees them; the odds, break-even and range are for everyone.
    return NextResponse.json(admin || !stats.context ? stats : { ...stats, context: { ...stats.context, roi: null, profit: null, staked: null } });
  } catch (err) {
    return engineUnavailable("api/stats", err);
  }
}
