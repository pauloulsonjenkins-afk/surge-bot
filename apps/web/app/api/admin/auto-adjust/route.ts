import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchAutoAdjust, setAutoAdjust } from "@/server/engine-client";

// Signed-in only. Read by the scheduled Claude cross-check: each auto-adjust run, what it changed and what it held back.
// POST { on: boolean } switches auto-adjust on or off.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorised(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

export async function GET() {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchAutoAdjust());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { on?: unknown };
    if (typeof body.on !== "boolean") return NextResponse.json({ error: "on must be true or false" }, { status: 400 });
    return NextResponse.json(await setAutoAdjust(body.on));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
