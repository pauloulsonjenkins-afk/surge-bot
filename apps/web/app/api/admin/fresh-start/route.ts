import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchFreshStart, saveFreshStart } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorised(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

export async function GET() {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchFreshStart());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { start?: unknown };
    if (typeof body.start !== "boolean") return NextResponse.json({ error: "start must be true or false" }, { status: 400 });
    return NextResponse.json(await saveFreshStart(body.start));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
