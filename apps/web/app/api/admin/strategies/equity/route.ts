import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchStrategyEquity, parsePickMode } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?label=X[&mode=live|sim]: one strategy's running profit, pick by pick, with its drawdown and losing runs. */
export async function GET(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
