import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { telegramLoginStart } from "@/server/telegram-admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  console.log("[telegram/login/start] request received");
  const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifySessionToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    console.log("[telegram/login/start] body parsed, calling engine");
    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
    if (!phoneNumber) {
      return NextResponse.json({ error: "phoneNumber is required." }, { status: 400 });
    }
    const result = await telegramLoginStart(phoneNumber);
    console.log("[telegram/login/start] engine responded", result);
    return NextResponse.json(result);
  } catch (err) {
    console.log("[telegram/login/start] error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
