import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchHorseBets, saveHorseDay, type HorseEntryInput } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** Every horse bet, for the Horses page (admin only). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchHorseBets());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** Body: { day: "YYYY-MM-DD", entries: [{ rank, horse, course, stake, odds, betType, ewFraction, ewPlaces }], yankeeStake: string | null }. */
export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { day?: unknown; entries?: unknown; yankeeStake?: unknown };
  if (typeof body.day !== "string" || !Array.isArray(body.entries)) return NextResponse.json({ error: "day and entries are required" }, { status: 400 });
  const entries: HorseEntryInput[] = (body.entries as Array<Record<string, unknown>>).slice(0, 4).map((e) => ({
    rank: Number(e.rank),
    horse: text(e.horse),
    course: text(e.course),
    stake: text(e.stake),
    odds: text(e.odds),
    betType: e.betType === "ew" ? "ew" : "win",
    ewFraction: typeof e.ewFraction === "number" ? e.ewFraction : null,
    ewPlaces: text(e.ewPlaces),
  }));
  try {
    const yankee = typeof body.yankeeStake === "string" || typeof body.yankeeStake === "number" ? String(body.yankeeStake) : null;
    return NextResponse.json(await saveHorseDay(body.day, entries, yankee));
  } catch (err) {
    // The engine's reason names the row and what's wrong, so it is passed on.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
