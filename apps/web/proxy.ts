import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, renewedSession } from "@/server/auth";
import { publicViewOn } from "@/server/access";

/**
 * Who sees which part of the site, decided before a page renders:
 *  - the admin sees everything (the main site's Dashboard, Live, Trade Log, Schedule, More and the admin pages);
 *  - everyone else is sent to the admin sign-in, unless the admin has switched Public view on (Admin > Settings).
 *    The Members area that used to be their site was removed on 14 Nov 2026; its old addresses lead here too;
 *  - the admin pages need the admin sign-in, as before.
 * Sign-in, sign-up and the admin sign-in page are always open. This is the coarse guard: the pages' data routes and
 * the (protected) admin layout check again on every request, so skipping it reveals nothing.
 */
export const config = {
  matcher: ["/", "/members/:path*", "/dashboard/:path*", "/live/:path*", "/trade-log/:path*", "/schedule/:path*", "/more", "/more/admin/:path((?!login).*)"],
};

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const renewed = await renewedSession(token);
  const admin = renewed !== null;
  // The admin's session is renewed on every page opened, and sent on a link from another app (a notification, Telegram, the
  // widget): it was "strict" and an 8-hour one, so those links arrived without it and landed on Members (7 Nov 2026).
  const keep = (res: NextResponse) => {
    if (renewed) res.cookies.set(ADMIN_COOKIE_NAME, renewed.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: renewed.maxAge });
    return res;
  };

  if (path.startsWith("/more/admin")) {
    if (admin) return keep(NextResponse.next());
    const loginUrl = new URL("/more/admin/login", req.url);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  // The admin's Dashboard is part of Home now (14 Nov 2026), so the old address and the front door both go there.
  if (admin) return keep(path === "/" || path === "/dashboard" || path.startsWith("/members") ? NextResponse.redirect(new URL("/more/admin/today", req.url)) : NextResponse.next());
  // A session that has run out (or was ended by a password change) is the admin's: back to the admin sign-in, not Members.
  if (token) {
    const loginUrl = new URL("/more/admin/login", req.url);
    loginUrl.searchParams.set("next", path === "/" || path.startsWith("/members") ? "/more/admin/today" : path);
    return NextResponse.redirect(loginUrl);
  }

  // Signed out. The Members area is gone (14 Nov 2026), so its old addresses and, unless Public view is on, every
  // other page lead to the admin sign-in.
  const open = !path.startsWith("/members") && (await publicViewOn());
  if (open) return path === "/" ? NextResponse.redirect(new URL("/dashboard", req.url)) : NextResponse.next();
  return NextResponse.redirect(new URL("/more/admin/login", req.url));
}
