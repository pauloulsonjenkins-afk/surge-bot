import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { ConfirmNeeded, fetchSending, saveSending, type SendingPatch } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorised(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

export async function GET() {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchSending());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as SendingPatch;
    return NextResponse.json(await saveSending(body));
  } catch (err) {
    // Nothing was saved: the page asks for the figure to be typed again and sends it as `confirm`.
    if (err instanceof ConfirmNeeded) return NextResponse.json({ error: "confirm_needed", reason: err.reason, confirm: err.items }, { status: 422 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}