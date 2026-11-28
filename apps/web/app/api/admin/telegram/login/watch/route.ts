import { NextRequest, NextResponse } from "next/server";
import { telegramWatchChat } from "@/server/telegram-admin-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return unauthorized();
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
