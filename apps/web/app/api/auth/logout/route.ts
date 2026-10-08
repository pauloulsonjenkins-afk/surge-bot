import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/server/auth";
import { USER_COOKIE_NAME } from "@/server/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  // Signing out of the account also ends an admin session that the account started (see ADMIN_EMAILS in the login route).
  res.cookies.set(ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
