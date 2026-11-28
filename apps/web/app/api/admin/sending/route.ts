import { NextResponse } from "next/server";
import { ConfirmNeeded, fetchSending, saveSending, type SendingPatch } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchSending());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  try {
    const body = (await request.json()) as SendingPatch;
    return NextResponse.json(await saveSending(body));
  } catch (err) {
    // Nothing was saved: the page asks for the figure to be typed again and sends it as `confirm`.
    if (err instanceof ConfirmNeeded) return NextResponse.json({ error: "confirm_needed", reason: err.reason, confirm: err.items }, { status: 422 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}