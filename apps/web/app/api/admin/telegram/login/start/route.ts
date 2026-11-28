import { NextRequest, NextResponse } from "next/server";
import { telegramLoginStart } from "@/server/telegram-admin-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  try {
    const body = await request.json();
    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
    if (!phoneNumber) return NextResponse.json({ error: "phoneNumber is required." }, { status: 400 });
    return NextResponse.json(await telegramLoginStart(phoneNumber));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
