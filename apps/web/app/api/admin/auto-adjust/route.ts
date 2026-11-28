import { NextResponse } from "next/server";
import { fetchAutoAdjust, setAutoAdjust } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

// Signed-in only. Read by the scheduled Claude cross-check: each auto-adjust run, what it changed and what it held back.
// POST { on: boolean } switches auto-adjust on or off.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchAutoAdjust());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  try {
    const body = (await request.json()) as { on?: unknown };
    if (typeof body.on !== "boolean") return NextResponse.json({ error: "on must be true or false" }, { status: 400 });
    return NextResponse.json(await setAutoAdjust(body.on));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
