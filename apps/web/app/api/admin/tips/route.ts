import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchTips, changeTips } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorised(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** The free tip channels and what was read from them (admin only). */
export async function GET() {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchTips());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the free tips." }, { status: 502 });
  }
}

/** Body: { action: "add" | "remove", channel } or { action: "review", chatKey, messageId, review: "tip" | "not" | null } (admin only). */
export async function POST(request: Request) {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return NextResponse.json(await changeTips(body));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change the free tips." }, { status: 502 });
  }
}
