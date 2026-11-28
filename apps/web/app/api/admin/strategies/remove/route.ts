import { NextResponse } from "next/server";
import { removeStrategy } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  try {
    const body = (await request.json()) as { label?: unknown; ignoreFuture?: unknown; includeSent?: unknown };
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
    return NextResponse.json(await removeStrategy(label, body.ignoreFuture === true, body.includeSent === true));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}