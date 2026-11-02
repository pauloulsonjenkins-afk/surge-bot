import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchArchive, setArchive } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorised(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** The archived strategies and their records (admin only). */
export async function GET() {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchArchive());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the archive." }, { status: 502 });
  }
}

/** Body: { label, archived, note? }. Archives or restores one strategy (admin only). */
export async function POST(request: Request) {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { label?: unknown; archived?: unknown; note?: unknown };
  if (typeof body.label !== "string" || typeof body.archived !== "boolean") return NextResponse.json({ error: "Which strategy?" }, { status: 400 });
  try {
    return NextResponse.json(await setArchive(body.label, body.archived, typeof body.note === "string" ? body.note : undefined));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change the archive." }, { status: 502 });
  }
}
