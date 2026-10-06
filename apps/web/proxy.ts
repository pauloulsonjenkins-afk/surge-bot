import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { publicViewOn } from "@/server/access";

/**
 * Who sees which part of the site, decided before a page renders:
 *  - the admin sees everything (the main site's Dashboard, Live, Trade Log, Schedule, More and the admin pages);
 *  - everyone else (signed out, or a member) has the Members area at /members as their whole site. The main site's
 *    pages send them there, unless the admin has switched Public view on (Admin > Settings);
 *  - the admin pages need the admin sign-in, as before.
 * Sign-in, sign-up and the admin sign-in page are always open. This is the coarse guard: the pages' data routes and
 * the (protected) admin layout check again on every request, so skipping it reveals nothing.
 */
export const config = {
  matcher: ["/", "/dashboard/:path*", "/live/:path*", "/trade-log/:path*", "/schedule/:path*", "/more", "/more/admin/:path((?!login).*)"],
};

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const admin = await verifySessionToken(req.cookies.get(ADMIN_COOKIE_NAME)?.value);

  if (path.startsWith("/more/admin")) {
    if (admin) return NextResponse.next();
    const loginUrl = new URL("/more/admin/login", req.url);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  if (admin) return path === "/" ? NextResponse.redirect(new URL("/dashboard", req.url)) : NextResponse.next();

  const open = await publicViewOn();
  if (path === "/") return NextResponse.redirect(new URL(open ? "/dashboard" : "/members", req.url));
  return open ? NextResponse.next() : NextResponse.redirect(new URL("/members", req.url));
}
