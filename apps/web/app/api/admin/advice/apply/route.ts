import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { applyStrategyAdvice, type StrategyAdvice } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: StrategyAdvice["kind"][] = ["try-live", "back-to-sim", "stake-up", "stake-down", "league-block"];

/** Body: { key, kind, league? (league-block: its league key) }. Carries out one strategy suggestion from Today (admin only). */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { key?: unknown; kind?: unknown; league?: unknown };
  const kind = KINDS.find((k) => k === body.kind);
  if (typeof body.key !== "string" || !kind) return NextResponse.json({ error: "Which suggestion?" }, { status: 400 });
  try {
    return NextResponse.json(await applyStrategyAdvice(body.key, kind, typeof body.league === "string" ? body.league : undefined));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't apply that." }, { status: 400 });
  }
}
