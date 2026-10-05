import { NextResponse } from "next/server";
import { isAdmin } from "@/server/access";
import { forAdmin } from "@/server/members-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The admin Members page: overview, commercial rules, member actions and STOP ALL live betting. Admin session only. */
const GETS = new Set(["overview", "config"]);
const POSTS = new Set(["config", "member", "stop-all-live"]);

type Params = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const path = (await params).path.join("/");
  if (!GETS.has(path)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return forAdmin("GET", path);
}

export async function POST(req: Request, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const path = (await params).path.join("/");
  if (!POSTS.has(path)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  return forAdmin("POST", path, body);
}
