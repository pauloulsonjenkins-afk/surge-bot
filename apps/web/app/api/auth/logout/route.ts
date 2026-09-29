import { NextResponse } from "next/server";
import { USER_COOKIE_NAME } from "@/server/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
