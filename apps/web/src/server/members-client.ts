/**
 * Server-only calls to the engine's /internal/members routes (never imported into client code).
 *
 * The member is identified ONLY by their signed sign-in cookie, read here on the server (currentUser), and passed to
 * the engine as X-Member-Id. Nothing in the browser's request can choose whose data is read. The engine then works out
 * what that member may see and builds only that.
 */
import { NextResponse } from "next/server";
import { currentUser } from "./access";

async function engineRequest(method: "GET" | "POST", path: string, memberId: number | null, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${baseUrl}/internal/members/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${internalKey}`,
        ...(memberId !== null ? { "X-Member-Id": String(memberId) } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } finally {
    clearTimeout(timeout);
  }
}

/** Passes a member's request to the engine and its answer back. 401 when nobody is signed in. */
export async function forMember(method: "GET" | "POST", path: string, body?: unknown): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const r = await engineRequest(method, path, user.id, body);
    return NextResponse.json(r.data, { status: r.status });
  } catch (err) {
    console.error(`[members/${path}]`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The members service isn't answering. Try again in a moment." }, { status: 502 });
  }
}

/** The admin's requests (no member id). The caller checks the admin session first. */
export async function forAdmin(method: "GET" | "POST", path: string, body?: unknown): Promise<NextResponse> {
  try {
    const r = await engineRequest(method, `admin/${path}`, null, body);
    return NextResponse.json(r.data, { status: r.status });
  } catch (err) {
    console.error(`[members/admin/${path}]`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The members service isn't answering. Try again in a moment." }, { status: 502 });
  }
}
