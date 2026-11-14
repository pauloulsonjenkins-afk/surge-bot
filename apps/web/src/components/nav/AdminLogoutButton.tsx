"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { forgetCache } from "@/queries/persist";

/** Sign out. `icon` is the square button used in the phone header, where the words didn't fit beside the other three. */
export default function AdminLogoutButton({ icon = false }: { icon?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    // The figures kept in the browser for a quick start include private ones, so they go too.
    forgetCache();
    try {
      await fetch("/api/admin/session", { method: "DELETE" });
    } finally {
      router.replace("/more/admin/login");
      router.refresh();
    }
  }

  if (icon) {
    return (
      <button
        type="button"
        onClick={handleLogout}
        disabled={pending}
        aria-label="Sign out"
        title="Sign out"
        className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-line text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
      >
        <LogOut size={15} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      className="text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
