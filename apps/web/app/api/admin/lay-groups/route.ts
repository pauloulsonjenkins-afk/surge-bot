import { NextResponse } from "next/server";
import { getLayReport, layGroupAction } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The LAY groups (what each lays and why) and the lay ideas (admin only). */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await getLayReport());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the LAY groups." }, { status: 502 });
  }
}

/** Body: { action: "watch", strategyKey, source, rule, why } lays an idea in Sim; { action: "unwatch", header } stops (admin only). */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "unwatch" && typeof body.header === "string") return NextResponse.json(await layGroupAction({ action: "unwatch", header: body.header }));
    if (body.action === "watch" && typeof body.strategyKey === "string" && typeof body.source === "string" && Array.isArray(body.rule))
      return NextResponse.json(
        await layGroupAction({ action: "watch", strategyKey: body.strategyKey, source: body.source, rule: body.rule.filter((x): x is string => typeof x === "string"), why: typeof body.why === "string" ? body.why : "" }),
      );
    return NextResponse.json({ error: "Which LAY group?" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't do that." }, { status: 400 });
  }
}
