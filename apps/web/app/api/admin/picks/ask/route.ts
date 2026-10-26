import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { askClaudeAboutPick } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WHY: Record<string, string> = {
  not_configured: "Claude isn't set up on the engine (no ANTHROPIC_API_KEY).",
  claude_failed: "Claude didn't answer. Try again in a moment.",
  pick_not_found: "That pick wasn't found.",
};

/** Body: { id, question }. Asks Claude one question about one pick (admin only). Advice only. */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; question?: unknown };
  const id = Number(b.id);
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 500) : "";
  if (!Number.isInteger(id) || !question) return NextResponse.json({ error: "Type a question first." }, { status: 400 });
  try {
    return NextResponse.json(await askClaudeAboutPick(id, question));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const code = Object.keys(WHY).find((k) => msg.includes(k));
    return NextResponse.json({ error: code ? WHY[code] : msg || "Couldn't ask Claude." }, { status: 502 });
  }
}
