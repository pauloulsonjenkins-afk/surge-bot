import { NextResponse } from "next/server";
import { GET as statsGET } from "../stats/route";
import { GET as breakdownGET } from "../performance/breakdown/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Dashboard's figures in one request: the hit-rate stats and the per-league breakdown, so the page polls once
 * instead of twice. It runs the two existing routes with the same query, so who may see what (and the money figures
 * kept from non-admins) is decided in exactly one place each.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const at = (path: string) => new Request(new URL(`${path}${url.search}`, url.origin), { headers: request.headers });
  const [statsRes, cellsRes] = await Promise.all([statsGET(at("/api/stats")), breakdownGET(at("/api/performance/breakdown"))]);
  if (!statsRes.ok) return statsRes;
  const stats = await statsRes.json();
  // The breakdown is optional: without it the page falls back to the simpler cards, as before.
  const cells = cellsRes.ok ? ((await cellsRes.json()) as { cells?: unknown }).cells ?? null : null;
  return NextResponse.json({ stats, cells });
}
