"use client";

import { useState } from "react";

/**
 * A long list on a phone: the first `step` items, then a button for the next lot (Leagues was ~31,000 px tall, Fix a
 * result ~22,000, the Trade Log ~16,000). `resetKey` starts it from the top again when what's listed changes (a search,
 * a filter, another day).
 */
export function useShowMore<T>(items: T[], step: number, resetKey: string = ""): { shown: T[]; more: React.ReactNode } {
  const [state, setState] = useState({ key: resetKey, count: step });
  // A new search or filter: back to the first lot (React's pattern for state that follows a prop).
  if (state.key !== resetKey) setState({ key: resetKey, count: step });
  const count = state.key === resetKey ? state.count : step;
  const shown = items.length > count ? items.slice(0, count) : items;
  const rest = items.length - shown.length;
  const more =
    rest > 0 ? (
      <button
        type="button"
        onClick={() => setState({ key: resetKey, count: count + step })}
        className="w-full rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2"
      >
        Show {Math.min(step, rest)} more <span className="font-normal text-ink-muted">· {rest} not shown</span>
      </button>
    ) : null;
  return { shown, more };
}
