import { NextResponse } from "next/server";
import { saveStrategyName } from "@/server/engine-client";
import { invalidate } from "@/server/cache";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { key, name, description }. Changes what the app shows for a strategy; empty values go back to the default. Admin only. */
export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; name?: unknown; description?: unknown };
  if (typeof body.key !== "string" || !body.key.trim()) return NextResponse.json({ error: "No strategy given." }, { status: 400 });
  try {
    const out = await saveStrategyName(body.key, typeof body.name === "string" ? body.name : "", typeof body.description === "string" ? body.description : "");
    invalidate("strategy-names");
    return NextResponse.json(out);
  } catch (err) {
    // The engine's reason ("The name can be at most 40 characters.") is written for the admin, so it is passed on.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
