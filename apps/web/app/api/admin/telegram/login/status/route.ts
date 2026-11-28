import { NextResponse } from "next/server";
import { telegramLoginStatus } from "@/server/telegram-admin-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return unauthorized();
  }

  try {
    const result = await telegramLoginStatus();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
