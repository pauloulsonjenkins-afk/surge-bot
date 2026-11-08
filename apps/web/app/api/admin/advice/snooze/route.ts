import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { snoozeStrategyAdvice, type StrategyAdvice } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: StrategyAdvice["kind"][] = ["try-live", "back-to-sim", "stake-up", "stake-down", "league-block", "slice-live", "slice-sim", "slice-stake-up", "slice-stake-down"];

/** Body: { key, kind, league?, hours? }. Ignores one suggestion for 24 hours (hours: 0 brings it back). Admin only. */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { key?: unknown; kind?: unknown; league?: unknown; hours?: unknown };
  const kind = KINDS.find((k) => k === body.kind);
  if (typeof body.key !== "string" || !kind) return NextResponse.json({ error: "Which suggestion?" }, { status: 400 });
  const hours = typeof body.hours === "number" ? body.hours : 24;
  try {
    return NextResponse.json(await snoozeStrategyAdvice(body.key, kind, hours, typeof body.league === "string" ? body.league : undefined));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't ignore that." }, { status: 400 });
  }
}
