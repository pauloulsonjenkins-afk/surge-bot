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

  const strategy = searchParams.get("strategy")?.trim().slice(0, 120) || null;
  // Live / simulation shows which picks were actually bet, so only the admin can split by it; everyone else sees every alert.
  const asked = parsePickMode(searchParams.get("mode"));
  const mode = asked !== "all" && (await verifySessionToken(cookies().get(ADMIN_COOKIE_NAME)?.value)) ? asked : "all";

  try {
    return NextResponse.json(
      await cached(`stats:${days}:${strategy ?? ""}:${mode}`, 5000, () => fetchHitRateStats(days, strategy, mode)),
    );
  } catch (err) {
    return engineUnavailable("api/stats", err);
  }
}
