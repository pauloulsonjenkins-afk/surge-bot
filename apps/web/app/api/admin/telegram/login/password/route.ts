import { NextRequest, NextResponse } from "next/server";
import { telegramSubmitPassword } from "@/server/telegram-admin-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return unauthorized();
  }

  try {
    const body = await request.json();
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password) {
      return NextResponse.json({ error: "password is required." }, { status: 400 });
    }
    const result = await telegramSubmitPassword(password);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
