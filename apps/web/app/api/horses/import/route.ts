import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { putHorseSuggestions, reportHorseImportFailed } from "@/server/engine-client";
import { clientIp, overLimit } from "@/server/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time comparison of the importer's key with HORSE_IMPORT_KEY (hashed first so the lengths always match). */
function keyOk(req: Request): boolean {
  const expected = process.env.HORSE_IMPORT_KEY;
  if (!expected || expected.length < 20) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

/**
 * Where the daily horse importer (tools/horse-import) sends what it read. It carries its own key (HORSE_IMPORT_KEY), which
 * opens this one route and nothing else, so the admin password never has to leave the website.
 *
 *   { day: "YYYY-MM-DD", picks: [{ horse, course, raceTime, odds }, ...up to 4], source?: string }  -> stored as suggestions
 *   { error: "what went wrong" }                                                                     -> the admin is notified
 *
 * Picks are only ever suggestions: they fill the Horses page's form when the admin presses a button. No stake is set and
 * nothing is bet.
 */
export async function POST(req: Request) {
  if (overLimit(`horse-import:${clientIp(req)}`, 20, 10 * 60 * 1000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (!keyOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { day?: unknown; picks?: unknown; source?: unknown; error?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    if (typeof body.error === "string" && body.error) {
      await reportHorseImportFailed(body.error);
      return NextResponse.json({ ok: true });
    }
    if (typeof body.day !== "string" || !Array.isArray(body.picks)) return NextResponse.json({ error: "day and picks are required." }, { status: 400 });
    const source = typeof body.source === "string" ? body.source : null;
    return NextResponse.json(await putHorseSuggestions(body.day, body.picks.slice(0, 5), source));
  } catch (err) {
    // The engine's reason ("Pick 2 has no horse name") helps the importer's log; nothing secret is in it.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
