import { NextResponse } from "next/server";
import { engineLogIn, toClientUser } from "@/server/users-client";
import { createUserToken, USER_COOKIE_NAME, USER_SESSION_MAX_AGE } from "@/server/user-auth";
import { ADMIN_COOKIE_NAME, ADMIN_REMEMBER_MAX_AGE, createSessionToken } from "@/server/auth";
import { clearLimit, clientIp, overLimit } from "@/server/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string" || !body.email || !body.password) {
    return NextResponse.json({ error: "Enter your email or username, and your password." }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase().slice(0, 254);

  // 10 tries per address per 5 minutes, and 10 per email per 15 minutes (so guessing one account is slow from anywhere).
  const emailKey = `login:email:${email}`;
  if (overLimit(`login:ip:${clientIp(req)}`, 10, 5 * 60 * 1000) || overLimit(emailKey, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  try {
    const r = await engineLogIn({ email, password: body.password });
    if (r.status === 200 && r.data.user) {
      clearLimit(emailKey);
      const res = NextResponse.json({ user: toClientUser(r.data.user) });
      res.cookies.set(USER_COOKIE_NAME, createUserToken(r.data.user.id, r.data.user.sessionVersion), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: USER_SESSION_MAX_AGE,
      });
      // The admin's own account is also the admin sign-in: an email listed in ADMIN_EMAILS gets the admin session too,
      // so one sign-in does both. Only an existing account that proved its password gets here, and emails are unique.
      const adminEmails = (process.env.ADMIN_EMAILS ?? "").toLowerCase().split(",").map((e) => e.trim()).filter(Boolean);
      if (adminEmails.includes(r.data.user.email.toLowerCase())) {
        res.cookies.set(ADMIN_COOKIE_NAME, await createSessionToken(true), {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          maxAge: ADMIN_REMEMBER_MAX_AGE,
        });
      }
      return res;
    }
    if (r.data.error === "disabled") {
      return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
    }
    return NextResponse.json({ error: "Email, username or password is wrong." }, { status: 401 });
  } catch (err) {
    console.error("[auth/login]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't reach the service. Try again in a moment." }, { status: 502 });
  }
}
