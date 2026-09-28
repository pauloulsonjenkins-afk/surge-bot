"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useUiStore } from "@/state/ui.store";

/** A small day/night button. It shows the mode you would switch TO: a sun in dark mode, a moon in light mode. */
export default function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  // The saved theme is only known in the browser, so wait until mounted before choosing an icon.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isLight = mounted && theme === "light";

  return (
    <button
      type="button"
      onClick={() => setTheme(isLight ? "dark" : "light")}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-line text-ink-muted transition-colors hover:text-ink"
    >
      {mounted ? isLight ? <Moon size={15} /> : <Sun size={15} /> : null}
    </button>
  );
}
