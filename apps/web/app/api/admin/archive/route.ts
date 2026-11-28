import { NextResponse } from "next/server";
import { fetchArchive, fetchArchivedKeys, setArchive } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The archived strategies and their records (admin only). ?keys=1: just which are archived, without the slow records. */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  try {
    if (new URL(request.url).searchParams.get("keys") === "1") return NextResponse.json({ keys: await fetchArchivedKeys() });
    return NextResponse.json(await fetchArchive());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the archive." }, { status: 502 });
  }
}

/** Body: { label, archived, note? }. Archives or restores one strategy (admin only). */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { label?: unknown; archived?: unknown; note?: unknown };
  if (typeof body.label !== "string" || typeof body.archived !== "boolean") return NextResponse.json({ error: "Which strategy?" }, { status: 400 });
  try {
    return NextResponse.json(await setArchive(body.label, body.archived, typeof body.note === "string" ? body.note : undefined));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change the archive." }, { status: 502 });
  }
}
