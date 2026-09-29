import { NextResponse } from "next/server";
import { engineUnavailable } from "@/server/public-error";
import { fetchHitRateStats } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { canViewData } from "@/server/access";

// Open to everyone while the public view switch is on. These are totals only (hit rates by strategy, league, day and minute).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await canViewData())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 3650) : null;

  const strategy = searchParams.get("strategy")?.trim().slice(0, 120) || null;

  try {
    return NextResponse.json(await cached(`stats:${days}:${strategy ?? ""}`, 5000, () => fetchHitRateStats(days, strategy)));
  } catch (err) {
    return engineUnavailable("api/stats", err);
  }
}
