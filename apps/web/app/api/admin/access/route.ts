import { NextResponse } from "next/server";
import { fetchPublicView, savePublicView } from "@/server/engine-client";
import { forgetPublicViewCache, isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json({ publicView: await fetchPublicView() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  try {
    const body = (await request.json()) as { publicView?: unknown };
    if (typeof body.publicView !== "boolean") {
      return NextResponse.json({ error: "publicView must be true or false" }, { status: 400 });
    }
    const value = await savePublicView(body.publicView);
    forgetPublicViewCache();
    return NextResponse.json({ publicView: value });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
