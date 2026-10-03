"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { forgetCache } from "@/queries/persist";

export default function AdminLogoutButton() {
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
