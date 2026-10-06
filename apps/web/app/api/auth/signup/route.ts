import { NextResponse } from "next/server";
import { engineSignUp } from "@/server/users-client";
import { clientIp, overLimit } from "@/server/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;

export async function POST(req: Request) {
  // 5 sign-ups an hour from one address, 60 an hour from everyone together.
  if (overLimit(`signup:ip:${clientIp(req)}`, 5, HOUR) || overLimit("signup:all", 60, HOUR)) {
    return NextResponse.json({ error: "Too many sign-ups from here. Try again later." }, { status: 429 });
  }

  let body: { email?: unknown; name?: unknown; username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Enter an email and a password." }, { status: 400 });
  }

  if (typeof body.name !== "string" || body.name.trim().length < 2) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (typeof body.username !== "string" || !/^[A-Za-z0-9_]{3,20}$/.test(body.username.trim())) {
    return NextResponse.json({ error: "Choose a username of 3 to 20 letters, numbers or underscores." }, { status: 400 });
  }

  try {
    const r = await engineSignUp({
      email: body.email,
      name: body.name,
      username: body.username.trim(),
      password: body.password,
    });
    if (r.status === 200) return NextResponse.json({ ok: true });
    const message =
      r.data.error === "signups_closed"
        ? "New sign-ups are closed right now."
        : r.data.error === "invalid_email"
          ? "That doesn't look like an email address."
          : r.data.error === "weak_password"
            ? "Use a password of at least 10 characters."
            : r.data.error === "name_required"
              ? "Enter your name."
              : r.data.error === "invalid_username"
                ? "That username isn't allowed. Use 3 to 20 letters, numbers or underscores, and not a word like admin."
                : r.data.error === "username_taken"
                  ? "That username is taken. Try another."
                  : "Couldn't create the account.";
    return NextResponse.json({ error: message }, { status: r.data.error === "signups_closed" ? 403 : 400 });
  } catch (err) {
    console.error("[auth/signup]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't reach the service. Try again in a moment." }, { status: 502 });
  }
}
