"use client";

import Link from "next/link";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

/**
 * Top bar shown on every tab page.
 *  - Signed out: a "Sign in" button that opens Clerk's sign-in pop-up.
 *  - Signed in:  Clerk's round user button (profile, manage account, sign out).
 * Both are drawn by Clerk once it has loaded, so nothing flashes the wrong state.
 */
export default function AppHeader() {
  return (
    <header
      className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-4">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight text-ink">
          Goal Brewing Alerts
        </Link>

        <div className="flex items-center gap-3">
          <SignedOut>
            <SignInButton mode="modal">
              <button
                type="button"
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
              >
                Sign in
              </button>
            </SignInButton>
          </SignedOut>

          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
