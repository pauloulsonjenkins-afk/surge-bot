import { NextResponse } from "next/server";
import { fetchPushState, pushAction } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The push key and the devices that get the admin's notifications. */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchPushState());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/**
 * { action: "subscribe", subscription, label } adds this device; { action: "unsubscribe", endpoint } removes it;
 * { action: "test" } sends every device a test notification.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; subscription?: unknown; label?: unknown; endpoint?: unknown };
  try {
    if (body.action === "subscribe") {
      // The site's own address goes to the push services as who sends these notifications.
      return NextResponse.json(await pushAction("subscribe", { subscription: body.subscription, label: body.label, origin: new URL(request.url).origin }));
    }
    if (body.action === "unsubscribe") return NextResponse.json(await pushAction("unsubscribe", { endpoint: body.endpoint }));
    if (body.action === "test") return NextResponse.json(await pushAction("test"));
    return NextResponse.json({ error: "invalid", message: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
