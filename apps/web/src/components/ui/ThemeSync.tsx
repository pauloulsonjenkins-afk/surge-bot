"use client";

import { useEffect } from "react";
import { useUiStore } from "@/state/ui.store";

const BROWSER_BAR = { dark: "#0E1116", light: "#F3F0E8" } as const;

/** Keeps the page's theme (and the phone's browser bar colour) in step with the saved choice. */
export default function ThemeSync() {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BROWSER_BAR[theme]);
  }, [theme]);

  return null;
}
