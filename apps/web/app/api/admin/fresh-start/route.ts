import { NextResponse } from "next/server";
import { fetchFreshStart, saveFreshStart } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchFreshStart());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  try {
    const body = (await request.json()) as { start?: unknown };
    if (typeof body.start !== "boolean") return NextResponse.json({ error: "start must be true or false" }, { status: 400 });
    return NextResponse.json(await saveFreshStart(body.start));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
