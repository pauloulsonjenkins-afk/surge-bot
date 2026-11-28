import { NextResponse } from "next/server";
import { fetchGolden, goldenAction, type LeagueFilter } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";
import { liveSlices } from "@/lib/strategy-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Golden: watched slices and the finder's suggestions (admin only). ?view=live: only the slices betting real money. */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  try {
    const report = await fetchGolden();
    if (new URL(request.url).searchParams.get("view") === "live") return NextResponse.json({ slices: liveSlices(report.slices) });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/**
 * Body: { action: "watch", strategyKey, rule }, { action: "unwatch", strategyKey, id }, { action: "notify", strategyKey,
 * id, on } (a slice's alert notifications; also the notification's own Mute button) or { action: "quiet", quiet }.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.action === "quiet" && typeof b.quiet === "boolean") return NextResponse.json(await goldenAction({ action: "quiet", quiet: b.quiet }));
    // { action: "alerts", allSlices?, hotToday?, leagues?, holdingOnly? }: every Golden slice, strategies doing well today,
    // only in green / not-red leagues, only slices holding their stage (golden-notify.ts).
    if (b.action === "alerts") {
      const leagues: LeagueFilter | undefined = b.leagues === "off" || b.leagues === "notRed" || b.leagues === "greenOnly" ? b.leagues : undefined;
      const patch = {
        ...(typeof b.allSlices === "boolean" ? { allSlices: b.allSlices } : {}),
        ...(typeof b.hotToday === "boolean" ? { hotToday: b.hotToday } : {}),
        ...(leagues ? { leagues } : {}),
        ...(typeof b.holdingOnly === "boolean" ? { holdingOnly: b.holdingOnly } : {}),
      };
      if (Object.keys(patch).length > 0) return NextResponse.json(await goldenAction({ action: "alerts", ...patch }));
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change that." }, { status: 400 });
  }
  if (typeof b.strategyKey !== "string") return NextResponse.json({ error: "Which strategy?" }, { status: 400 });
  try {
    if (b.action === "notify" && typeof b.id === "string" && typeof b.on === "boolean") return NextResponse.json(await goldenAction({ action: "notify", strategyKey: b.strategyKey, id: b.id, on: b.on }));
    if (b.action === "watch" && Array.isArray(b.rule)) return NextResponse.json(await goldenAction({ action: "watch", strategyKey: b.strategyKey, rule: b.rule.map(String) }));
    if (b.action === "unwatch" && typeof b.id === "string") return NextResponse.json(await goldenAction({ action: "unwatch", strategyKey: b.strategyKey, id: b.id }));
    return NextResponse.json({ error: "What should change?" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change that." }, { status: 400 });
  }
}
