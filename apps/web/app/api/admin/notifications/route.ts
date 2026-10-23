import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { getNotifications } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every notification sent to the admin, last 60 days, newest first (admin only). */
export async function GET() {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getNotifications());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the notifications." }, { status: 502 });
  }
}
