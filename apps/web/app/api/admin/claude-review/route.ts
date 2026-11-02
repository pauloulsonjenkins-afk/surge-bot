import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchClaudeReviews, rejectClaudeRecommendation } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorised = async () => verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);

/** Claude's latest daily note and its recommendations (admin only). */
export async function GET() {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchClaudeReviews());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load Claude's review." }, { status: 502 });
  }
}

/** Body: { key, kind, league? }. Turns down one of Claude's recommendations (accepting one is the ordinary Apply). */
export async function POST(request: Request) {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { key?: unknown; kind?: unknown; league?: unknown };
  if (typeof body.key !== "string" || typeof body.kind !== "string") return NextResponse.json({ error: "Which recommendation?" }, { status: 400 });
  try {
    return NextResponse.json(await rejectClaudeRecommendation({ key: body.key, kind: body.kind, ...(typeof body.league === "string" ? { league: body.league } : {}) }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't reject that." }, { status: 502 });
  }
}
