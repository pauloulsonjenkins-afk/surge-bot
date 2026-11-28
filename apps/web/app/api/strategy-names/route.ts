import { NextResponse } from "next/server";
import { engineUnavailable } from "@/server/public-error";
import { fetchStrategyNames } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { isAdmin } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The names the app shows for strategies ("Time to fight" shows as "Wake-up Call"), for every page. Anyone gets the
 * names; the admin also gets each strategy's description, trigger and bet (the Strategies page), which describe how the
 * strategies work and so stay private.
 */
export async function GET() {
  const admin = await isAdmin();
  try {
    const { names } = await cached("strategy-names", 30_000, fetchStrategyNames);
    if (admin) return NextResponse.json({ names });
    return NextResponse.json({ names: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, { name: v.name }])) });
  } catch (err) {
    return engineUnavailable("api/strategy-names", err);
  }
}
