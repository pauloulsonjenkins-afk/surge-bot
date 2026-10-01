import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { telegramWatchChat } from "@/server/telegram-admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifySessionToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const chatId = typeof body?.chatId === "string" ? body.chatId : "";
    if (!chatId) {
      return NextResponse.json({ error: "chatId is required." }, { status: 400 });
    }
    const result = await telegramWatchChat(chatId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
