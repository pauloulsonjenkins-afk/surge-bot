import { NextResponse } from "next/server";
import { getNotifications } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every notification sent to the admin, last 60 days, newest first (admin only). */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await getNotifications());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the notifications." }, { status: 502 });
  }
}
