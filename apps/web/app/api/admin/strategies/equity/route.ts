import { NextResponse } from "next/server";
import { fetchStrategyEquity, parsePickMode } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?label=X[&mode=live|sim]: one strategy's running profit, pick by pick, with its drawdown and losing runs. */
export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  const { searchParams } = new URL(request.url);
  const label = searchParams.get("label")?.trim().slice(0, 120) ?? "";
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  try {
    return NextResponse.json(await fetchStrategyEquity(label, parsePickMode(searchParams.get("mode"))));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
