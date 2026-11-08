"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useUiStore } from "@/state/ui.store";

const BROWSER_BAR = { dark: "#17120E", light: "#F5EFE6" } as const;
const QUERY = "(prefers-color-scheme: light)";

function subscribe(onChange: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/** The theme actually shown: the saved choice, or the device's own setting while none is saved ("system"). */
export function useResolvedTheme(): "dark" | "light" {
  const theme = useUiStore((s) => s.theme);
  const systemLight = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  return theme === "system" ? (systemLight ? "light" : "dark") : theme;
}

/** Keeps the page's theme (and the phone's browser bar colour) in step with the saved choice or the device's setting. */
export default function ThemeSync() {
  const theme = useResolvedTheme();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BROWSER_BAR[theme]);
  }, [theme]);

  return null;
}
