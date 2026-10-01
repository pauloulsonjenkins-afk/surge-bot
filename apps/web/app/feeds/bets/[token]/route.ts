import { NextResponse } from "next/server";

// The feed itself lives on the engine. This route just passes the request on,
// so the feed can be reached on the same public address as the site, with no
// extra routing set up in DigitalOcean. The engine checks the secret token in
// the link; a wrong token gets the same plain 404 as any missing page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new NextResponse("Not found", { status: 404 });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const baseUrl = process.env.ENGINE_BASE_URL;
  if (!baseUrl) return NOT_FOUND();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/feeds/bets/${encodeURIComponent((await params).token)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return NOT_FOUND();
    return new NextResponse(await res.text(), {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    // Engine unreachable: an error status (not an empty file) so the betting software doesn't read it as "no picks".
    return new NextResponse("Feed unavailable", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
