import { NextResponse } from "next/server";
import { engineUnavailable } from "@/server/public-error";
import { fetchLivePicks, toPublicPick, type PublicPick } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { dataGate, isAdmin } from "@/server/access";

// Open to the admin, to anyone while the public view switch is on (Admin, Settings), and to signed-in users given this page. Only the trimmed public shape is returned: no raw
// alert text, no ids, no stakes and nothing about what was sent to bet.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = await dataGate("live");
  if (blocked) return blocked;
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 200) : 50;
  // open=1 (the Live tab): only picks still without a result from the last two days, the only ones it shows. Most of
  // the latest 200 are settled, so this sends a small part of the list every 15 seconds instead of all of it.
  const open = searchParams.get("open") === "1";

  try {
    const picks = await cached(`live:${limit}`, 4000, async () => (await fetchLivePicks(limit)).map(toPublicPick));
    const now = Date.now();
    const shown = open ? picks.filter((p) => p.status !== "settled" && now - Date.parse(p.firstSeenAt) < OPEN_MS) : picks;
    return NextResponse.json({ picks: (await isAdmin()) ? shown : shown.map(hidePrivate) });
  } catch (err) {
    return engineUnavailable("api/live", err);
  }
}

/** How far back open=1 looks: the Live tab's waiting list goes back 24 hours from kick-off, so two days from the alert. */
const OPEN_MS = 48 * 60 * 60 * 1000;

/**
 * What only the admin sees: whether a pick was handed to the betting software, and what Betfair said about its match.
 * Which picks were bet is private, as on /api/stats (which keeps the Live / Sim split and the money to the admin).
 */
function hidePrivate(p: PublicPick): PublicPick {
  return { ...p, sentAt: null, exchange: null, exchangeEvent: null, exchangeOdds: null, marketCheck: null, marketCheckDetail: null, exchangeCandidates: null, claudeVerdict: null, similar: null };
}
