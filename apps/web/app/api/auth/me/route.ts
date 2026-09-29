import { NextResponse } from "next/server";
import { currentUser, isAdmin, publicViewOn } from "@/server/access";
import { toClientUser } from "@/server/users-client";
import { USER_PAGES, type UserPage } from "@/lib/user-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is looking, and which page groups they can open. Used to show the account card and hide tabs. */
export async function GET() {
  const [admin, user, open] = await Promise.all([isAdmin(), currentUser(), publicViewOn()]);
  const pages: UserPage[] = admin || open ? [...USER_PAGES] : user ? user.pages : [];
  return NextResponse.json({ admin, publicView: open, user: user ? toClientUser(user) : null, pages });
}
