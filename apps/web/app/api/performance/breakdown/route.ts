import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { engineUnavailable } from "@/server/public-error";
import { fetchPerformanceCells, parsePickMode } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { dataGate } from "@/server/access";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";

// Open to the admin, to anyone while the public view switch is on, and to signed-in users given this page. Totals only: counts by league, strategy and alert minute, never individual alerts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = await dataGate("dashboard");
  if (blocked) return blocked;
  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 3650) : null;
  // Live / simulation is admin-only, as on /api/stats.
  const asked = parsePickMode(searchParams.get("mode"));
  const mode = asked !== "all" && (await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value)) ? asked : "all";

  try {
    return NextResponse.json({ cells: await cached(`performance:${days}:${mode}`, 5000, () => fetchPerformanceCells(days, mode)) });
  } catch (err) {
    return engineUnavailable("api/performance/breakdown", err);
  }
}
