import { NextResponse } from "next/server";

/**
 * The reply a public data route gives when the engine can't be reached. The real reason goes to
 * the server log only: engine error text can name environment variables and internal addresses.
 */
export function engineUnavailable(route: string, err: unknown): NextResponse {
  console.error(`[${route}] engine request failed:`, err instanceof Error ? err.message : String(err));
  return NextResponse.json({ error: "The data is temporarily unavailable. Try again in a moment." }, { status: 502 });
}
