import { NextResponse } from "next/server";
import { engineUnavailable } from "@/server/public-error";
import { fetchPerformanceCells, parsePickMode } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { dataGate, isAdmin } from "@/server/access";

// Open to the admin, and to anyone while the public view switch is on. Totals only: counts by league, strategy and alert minute, never individual alerts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = await dataGate();
  if (blocked) return blocked;
  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 3650) : null;
  const sinceRaw = searchParams.get("since");
  const since = sinceRaw && Number.isFinite(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  // Live / simulation is admin-only, as on /api/stats.
  const asked = parsePickMode(searchParams.get("mode"));
  const mode = asked !== "all" && (await isAdmin()) ? asked : "all";

  try {
    return NextResponse.json({ cells: await cached(`performance:${since ?? days}:${mode}`, 5000, () => fetchPerformanceCells(days, mode, since)) });
  } catch (err) {
    return engineUnavailable("api/performance/breakdown", err);
  }
}
