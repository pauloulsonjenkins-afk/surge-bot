"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A figure that glows briefly when its value changes (a result settles and "Live today" moves), so you can see what
 * just changed. Not on the first showing; off for anyone who has asked their device for reduced motion (globals.css).
 */
export function Flash({ value, children, className = "" }: { value: string | number; children: React.ReactNode; className?: string }) {
  const first = useRef(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setTick((t) => t + 1);
  }, [value]);
  return (
    <span key={tick} className={`${tick > 0 ? "flash" : ""} -mx-1 rounded-md px-1 ${className}`}>
      {children}
    </span>
  );
}
