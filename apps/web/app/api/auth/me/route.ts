import { NextResponse } from "next/server";
import { isAdmin, publicViewOn } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is looking: the admin, or a visitor while Public view is on. */
export async function GET() {
  const [admin, publicView] = await Promise.all([isAdmin(), publicViewOn()]);
  return NextResponse.json({ admin, publicView });
}
