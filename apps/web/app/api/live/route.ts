import { NextResponse } from "next/server";
import { engineUnavailable } from "@/server/public-error";
import { fetchLivePicks, toPublicPick } from "@/server/engine-client";
import { cached } from "@/server/cache";
import { dataGate } from "@/server/access";

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

  try {
    const picks = await cached(`live:${limit}`, 4000, async () => (await fetchLivePicks(limit)).map(toPublicPick));
    return NextResponse.json({ picks });
  } catch (err) {
    return engineUnavailable("api/live", err);
  }
}