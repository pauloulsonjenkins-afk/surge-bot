import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";

// Two jobs, in one file (Next.js only allows one middleware file):
//
// 1. Clerk: makes the signed-in / signed-out state available to the whole site.
//    It does NOT block any page by itself. Nobody is forced to sign in.
//
// 2. The existing admin password gate, unchanged. Requests to /more/admin/*
//    (except the login page) are bounced to the login page unless they carry a
//    valid admin session cookie. The (protected) layout re-checks the same
//    cookie on the server, so this is a shortcut, not the only lock.
export default clerkMiddleware(async (_auth, req) => {
  const path = req.nextUrl.pathname;
  const isAdminArea = path === "/more/admin" || path.startsWith("/more/admin/");
  const isAdminLogin = path.startsWith("/more/admin/login");

  if (isAdminArea && !isAdminLogin) {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const valid = await verifySessionToken(token);
    if (!valid) {
      const loginUrl = new URL("/more/admin/login", req.url);
      loginUrl.searchParams.set("next", path);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Everything except Next.js internals, static files, and the private bet feed.
    // The bet feed (/feeds/...) is pulled by your betting software with no browser
    // cookies, so it is deliberately kept away from Clerk and can never be affected by it.
    "/((?!_next|feeds|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes (except the bet feed, which lives under /feeds).
    "/(api|trpc)(.*)",
  ],
};
