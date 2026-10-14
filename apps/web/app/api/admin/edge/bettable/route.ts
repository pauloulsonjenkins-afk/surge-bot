import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { valueBets } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorised = async () => verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);

/** Best Value Cuppa picks that can still be bet by hand (admin only). */
export async function GET() {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await valueBets());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
