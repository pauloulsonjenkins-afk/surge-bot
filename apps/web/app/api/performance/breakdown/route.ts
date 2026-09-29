import { NextResponse } from "next/server";
import { engineUnavailable } from "@/server/public-error";
import { fetchPerformanceCells } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { dataGate } from "@/server/access";

// Open to the admin, to anyone while the public view switch is on, and to signed-in users given this page. Totals only: counts by league, strategy and alert minute, never individual alerts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = await dataGate("dashboard");
  if (blocked) return blocked;
  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 3650) : null;

  try {
    return NextResponse.json({ cells: await cached(`performance:${days}`, 5000, () => fetchPerformanceCells(days)) });
  } catch (err) {
    return engineUnavailable("api/performance/breakdown", err);
  }
}