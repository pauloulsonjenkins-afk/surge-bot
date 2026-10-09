import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { fetchToday } from "@/server/engine-client";
import { AMBER, widgetSummary } from "@/lib/widget";
import { clientIp, overLimit } from "@/server/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A small, READ-ONLY summary of the Today page for a phone home-screen widget (KWGT on Android: see apps/web/WIDGET.md).
 *
 * Opened by its own key, WIDGET_KEY (set on the website's DigitalOcean component, 20+ characters), given as ?key=…
 * because widget apps can't send headers. The key opens this summary and nothing else: no settings, no bets, no
 * member data. If it ever leaks, change WIDGET_KEY and update the widget.
 */
function keyOk(given: string | null): boolean {
  const expected = process.env.WIDGET_KEY;
  if (!expected || expected.length < 20 || !given) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

export async function GET(request: Request) {
  if (overLimit(`widget:${clientIp(request)}`, 120, 60 * 60 * 1000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (!keyOk(new URL(request.url).searchParams.get("key"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(widgetSummary(await fetchToday()), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ status: "Unknown", statusColor: AMBER, warning: "GoalBrew didn't answer", line1: "GoalBrew didn't answer", line2: err instanceof Error ? err.message : "" }, { status: 502 });
  }
}
