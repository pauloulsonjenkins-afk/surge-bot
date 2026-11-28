import { NextResponse } from "next/server";
import { setHorseResult, type HorseBet } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS = new Set(["pending", "won", "placed", "lost", "void"]);

/** Body: { id: number, result: "won" | "placed" | "lost" | "void" | "pending" }. */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; result?: unknown };
  if (typeof body.id !== "number" || typeof body.result !== "string" || !RESULTS.has(body.result)) {
    return NextResponse.json({ error: "id and result are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await setHorseResult(body.id, body.result as HorseBet["result"]));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
