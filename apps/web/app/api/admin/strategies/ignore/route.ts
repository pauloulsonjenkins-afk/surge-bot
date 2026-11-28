import { NextResponse } from "next/server";
import { setStrategyIgnored } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { label: string, ignored: boolean }. Starts or stops ignoring a strategy's new alerts. */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  try {
    const body = (await request.json()) as { label?: unknown; ignored?: unknown };
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label || typeof body.ignored !== "boolean") return NextResponse.json({ error: "label and ignored are required" }, { status: 400 });
    await setStrategyIgnored(label, body.ignored);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
