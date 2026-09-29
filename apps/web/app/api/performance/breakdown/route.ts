import { NextResponse } from "next/server";
import { engineUnavailable } from "@/server/public-error";
import { fetchPerformanceCells } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { canViewData } from "@/server/access";

// Open to everyone while the public view switch is on. Totals only: counts by league, strategy and alert minute, never individual alerts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await canViewData())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 3650) : null;

  try {
    return NextResponse.json({ cells: await cached(`performance:${days}`, 5000, () => fetchPerformanceCells(days)) });
  } catch (err) {
    return engineUnavailable("api/performance/breakdown", err);
  }
}