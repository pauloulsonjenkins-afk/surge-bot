import { NextResponse } from "next/server";
import { isAdmin } from "@/server/access";
import {
  engineDeleteUser,
  engineListUsers,
  engineSetSignupsOpen,
  engineUpdateUser,
  forgetUserSessions,
  toClientUser,
} from "@/server/users-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    const r = await engineListUsers();
    return NextResponse.json({ users: r.data.users.map(toClientUser), signupsOpen: r.data.signupsOpen });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** One route for every change: { action: "update" | "delete" | "signups", ... }. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request.");
  }

  try {
    if (body.action === "signups") {
      if (typeof body.open !== "boolean") return bad("open must be true or false");
      const r = await engineSetSignupsOpen(body.open);
      return NextResponse.json({ signupsOpen: r.data.signupsOpen === true });
    }

    const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : null;
    if (id === null) return bad("A user id is required.");

    if (body.action === "delete") {
      const r = await engineDeleteUser(id);
      forgetUserSessions();
      return r.status === 200 ? NextResponse.json({ ok: true }) : bad(r.data.error ?? "Couldn't delete.", r.status);
    }

    if (body.action === "update") {
      // Only these fields can be changed from the browser.
      const patch: Record<string, unknown> = { id };
      for (const k of ["name", "pages", "active", "password", "signOutEverywhere"] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const r = await engineUpdateUser(patch);
      forgetUserSessions();
      if (r.status !== 200 || !r.data.user) {
        const message = r.data.error === "weak_password" ? "Use a password of at least 10 characters." : (r.data.error ?? "Couldn't save.");
        return bad(message, r.status === 404 ? 404 : 400);
      }
      return NextResponse.json({ user: toClientUser(r.data.user) });
    }

    return bad("Unknown action.");
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
