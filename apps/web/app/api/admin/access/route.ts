import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchPublicView, savePublicView } from "@/server/engine-client";
import { forgetPublicViewCache } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorised(): Promise<boolean> {
  return verifySessionToken(cookies().get(ADMIN_COOKIE_NAME)?.value);
}

export async function GET() {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ publicView: await fetchPublicView() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
