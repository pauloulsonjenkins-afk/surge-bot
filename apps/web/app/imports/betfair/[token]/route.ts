import { NextResponse } from "next/server";

// The automatic bet history import (tools/bf-import.ps1 posts the export here). Like the bet feed, the engine holds the
// secret token and checks it; this route just passes the request on, so it can use the site's public address.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const baseUrl = process.env.ENGINE_BASE_URL;
  if (!baseUrl) return new NextResponse("Not found", { status: 404 });
  const name = new URL(request.url).searchParams.get("name") ?? "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${baseUrl}/imports/betfair/${encodeURIComponent((await params).token)}?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv; charset=utf-8" },
      body: await request.text(),
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.status === 404) return new NextResponse("Not found", { status: 404 });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
