"use client";

import { useEffect, useRef, useState } from "react";

const CLAMP = { 2: "line-clamp-2", 4: "line-clamp-4" } as const;

/**
 * Text cut to a few lines, with a "more" / "less" button shown only when it really is cut off (measured, and
 * re-measured when the width changes). A "more" on text that already fits does nothing when tapped, which read as a bug.
 */
export function ClampedText({ text, lines = 2, label, className = "" }: { text: string; lines?: 2 | 4; label?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text, open]);

  return (
    <div className={className}>
      {/* Never "block" together with the clamp: line-clamp needs its own display (-webkit-box), and "block" overrode it, so
          nothing was ever cut (29 Oct 2026: Claude's review on Today ran to 560 px, with no "more"). */}
      <span ref={ref} className={open ? "block" : CLAMP[lines]}>
        {label && <span className="font-medium text-ink-muted">{label} </span>}
        {text}
      </span>
      {(clipped || open) && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mt-0.5 inline-flex min-h-8 items-center text-accent">
          {open ? "less" : "more"}
        </button>
      )}
    </div>
  );
}
