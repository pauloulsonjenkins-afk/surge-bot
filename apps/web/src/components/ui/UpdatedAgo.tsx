"use client";

import { useEffect, useState } from "react";

/**
 * "Updated 12 s ago", ticking. Turns amber once the figures are older than `staleAfter` seconds, so a page that has
 * quietly stopped refreshing never passes for a live one.
 */
export function UpdatedAgo({ at, staleAfter = 90, className = "" }: { at: number | null | undefined; staleAfter?: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!at) return null;
  const secs = Math.max(0, Math.round((now - at) / 1000));
  const text = secs < 60 ? `${secs} s` : secs < 3600 ? `${Math.floor(secs / 60)} min` : `${Math.floor(secs / 3600)} h`;
  const stale = secs > staleAfter;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs tabular-nums ${stale ? "text-warn" : "text-ink-muted"} ${className}`} title={stale ? "These figures haven't refreshed recently" : undefined}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-warn" : "bg-hit"}`} />
      {stale ? `Not updated for ${text}` : `Updated ${text} ago`}
    </span>
  );
}
