import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchClaudeVerdictCheck, setClaudeSwitches, type ClaudeSwitches } from "@/server/engine-client";

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

/** Body: any of { badgeVisible, paused, hideInLine } as booleans: the Live tab badge, pausing the per-alert check, hiding "in line". */
export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const keys = ["badgeVisible", "paused", "hideInLine"] as const;
  const body: ClaudeSwitches = {};
  for (const k of keys) if (typeof b[k] === "boolean") body[k] = b[k] as boolean;
  if (Object.keys(body).length === 0) return NextResponse.json({ error: "switches_must_be_boolean" }, { status: 400 });
  try {
    return NextResponse.json(await setClaudeSwitches(body));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change that." }, { status: 400 });
  }
}
