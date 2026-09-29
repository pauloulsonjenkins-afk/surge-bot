import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";

// Coarse guard: bounces obviously-unauthenticated requests to the protected
// admin routes before they render. This is a UX shortcut, not the source of
// truth — the (protected) layout re-verifies the same token server-side on
// every request, so a request that somehow skips middleware still can't
// reach an admin subpage without a valid session.
export const config = {
  matcher: ["/more/admin/:path((?!login).*)"],
};

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const valid = await verifySessionToken(token);

  if (!valid) {
    const loginUrl = new URL("/more/admin/login", req.url);
    loginUrl.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
