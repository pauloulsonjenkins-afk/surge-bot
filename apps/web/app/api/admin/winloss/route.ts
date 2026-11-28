import { NextResponse } from "next/server";
import { fetchWinLoss, parsePickMode, saveWinLoss, type WinLossPatch } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

// Signed-in only: this holds stakes and profit figures and is never part of the public view.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchWinLoss(parsePickMode(new URL(request.url).searchParams.get("mode"))));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  try {
    const mode = parsePickMode(new URL(request.url).searchParams.get("mode"));
    return NextResponse.json(await saveWinLoss((await request.json()) as WinLossPatch, mode));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
