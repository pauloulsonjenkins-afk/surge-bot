import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchClaudeVerdictCheck, setClaudeBadgeVisible } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin() {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** Claude's per-alert verdicts compared against settled results, by verdict (admin only). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchClaudeVerdictCheck());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** Body: { badgeVisible: boolean } — shows or hides the Live tab's Claude badge (shadow mode switch). */
export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.badgeVisible !== "boolean") return NextResponse.json({ error: "badgeVisible_must_be_boolean" }, { status: 400 });
  try {
    return NextResponse.json(await setClaudeBadgeVisible(b.badgeVisible));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change that." }, { status: 400 });
  }
}
