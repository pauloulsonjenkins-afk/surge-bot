"use client";

import { useEffect, useState } from "react";

/** Elements a tap already does something with: a tap on these (or inside them) is left alone; a long-press still shows the tip. */
const INTERACTIVE = "a, button, summary, label, input, select, textarea, [role=button], [role=radio], [role=tab]";
const WIDTH = 280;
const GUTTER = 12;

interface Tip {
  text: string;
  left: number;
  top: number;
  above: boolean;
}

/**
 * Phones have no hover, so the app's hover tips (title="…" on warning signs, chips, figures: about 180 of them) never
 * showed there. On a touch screen this shows one in a small bubble by the element: tap something that has a tip and
 * does nothing else when tapped (a warning sign, a chip, a week's figure), or long-press anything that has one. The
 * bubble goes on the next touch, on scrolling, or after a few seconds. Mounted once, in the root layout.
 */
export default function TouchTips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let hideTimer: number | undefined;

    const show = (el: Element) => {
      const text = el.getAttribute("title")?.trim();
      if (!text) return false;
      const r = el.getBoundingClientRect();
      const left = Math.min(Math.max(GUTTER, r.left + r.width / 2 - WIDTH / 2), Math.max(GUTTER, window.innerWidth - GUTTER - WIDTH));
      const above = r.top > 96;
      setTip({ text, left, top: above ? r.top - 8 : r.bottom + 8, above });
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setTip(null), 5000);
      return true;
    };
    const titled = (t: EventTarget | null) => (t instanceof Element ? t.closest("[title]") : null);

    // A plain tap: only where the tap has no other job.
    const onClick = (e: MouseEvent) => {
      const el = titled(e.target);
      if (!el || (e.target as Element).closest(INTERACTIVE)) return;
      show(el);
    };
    // A long-press (Chrome on Android raises contextmenu for it): anything with a tip, in place of the copy menu.
    const onContextMenu = (e: MouseEvent) => {
      const el = titled(e.target);
      if (el && show(el)) e.preventDefault();
    };
    const hide = () => setTip(null);
    const onTouchStart = (e: TouchEvent) => {
      if (!titled(e.target)) hide();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => {
      window.clearTimeout(hideTimer);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("touchstart", onTouchStart, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      aria-live="polite"
      className="pointer-events-none fixed z-50 rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-ink shadow-lg"
      style={{ left: tip.left, top: tip.top, maxWidth: WIDTH, width: "max-content", transform: tip.above ? "translateY(-100%)" : undefined }}
    >
      {tip.text}
    </div>
  );
}
