"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell } from "lucide-react";
import { ADMIN_HOME } from "@/lib/admin-sections";
import ThemeToggle from "@/components/ui/ThemeToggle";
import AdminLogoutButton from "./AdminLogoutButton";

/**
 * The admin's header on phones and tablets, the same on every page (14 Nov 2026): the logo (which goes Home), the
 * notification log, the day/night switch and Sign out. It replaces the "ADMIN / Sign out" strip, which took a row on
 * every admin page to say one word, and gives the theme switch a home (it was only on the Dashboard). Wide screens have
 * all of this in the sidebar.
 */
export default function AdminTopBar() {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pt-3 lg:hidden">
      <Link href={ADMIN_HOME} aria-label="GoalBrew: Home" className="tap-target flex items-center">
        <Image unoptimized priority src="/brand/goalbrew-logo-dark.svg" alt="" width={144} height={24} className="h-6 w-auto [[data-theme=light]_&]:hidden" />
        <Image unoptimized src="/brand/goalbrew-logo-light.svg" alt="" width={144} height={24} className="hidden h-6 w-auto [[data-theme=light]_&]:block" />
      </Link>
      <div className="flex items-center gap-2">
        <Link
          href="/more/admin/notifications"
          aria-label="Notifications"
          title="Notifications"
          className="tap-target flex h-[30px] w-[30px] [@media(pointer:coarse)]:w-11 items-center justify-center rounded-md border border-line text-ink-muted transition-colors hover:text-ink"
        >
          <Bell size={15} />
        </Link>
        <ThemeToggle />
        <span className="pl-1">
          <AdminLogoutButton />
        </span>
      </div>
    </header>
  );
}
