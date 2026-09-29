import { NextResponse } from "next/server";
import { engineUnavailable } from "@/server/public-error";
import { fetchSchedule } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { dataGate } from "@/server/access";

// Open to the admin, to anyone while the public view switch is on, and to signed-in users given this page. Public fixture information only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

export async function GET(request: Request) {
  const blocked = await dataGate("schedule");
  if (blocked) return blocked;
  const { searchParams } = new URL(request.url);
  // "tomorrow" is worked out in UK time; anything else means today (the engine's own UK date).
  const date =
    searchParams.get("day") === "tomorrow" ? ukDay.format(new Date(Date.now() + 24 * 60 * 60 * 1000)) : null;

  try {
    return NextResponse.json(await cached(`schedule:${date ?? "today"}`, 30_000, () => fetchSchedule(date)));
  } catch (err) {
    return engineUnavailable("api/schedule", err);
  }
}