"use client";

import { useEffect, useRef } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { useMe } from "@/queries/use-me";
import { useUiStore } from "@/state/ui.store";
import { ModeToggle, UnitToggle } from "@/components/ui/ModeToggle";
import { TIMEFRAMES, TimeframeToggle, type Timeframe } from "./TimeframeToggle";

const PERIOD_WORD: Record<Timeframe, string> = { "1D": "Today", "7D": "7 days", "30D": "30 days", ALL: "All time" };
const MODE_WORD = { live: "Live", sim: "Sim", all: "All picks" } as const;

/**
 * The Dashboard's view as one line, "Today · Live · £", on phones (design review, 8 Nov 2026: three switches and three
 * pills came before the headline figure). A tap opens a sheet with the three choices; every figure and chart on the
 * page follows them. Wide screens keep the switches in a row (see DashboardPage).
 */
export function ViewPill({ timeframe, onTimeframe }: { timeframe: Timeframe; onTimeframe: (t: Timeframe) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { data: me } = useMe();
  const mode = useUiStore((s) => s.pickMode);
  const unit = useUiStore((s) => s.profitUnit);
  const parts = [PERIOD_WORD[timeframe], ...(me?.admin ? [MODE_WORD[mode], unit === "units" ? "Units" : "£"] : [])];

  // A tap on the dimmed backdrop (outside the sheet) closes it.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close();
    };
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-haspopup="dialog"
        className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface pl-4 pr-3 text-sm text-ink transition-colors hover:bg-surface-2"
      >
        <span>
          <span className="font-semibold">{parts[0]}</span>
          {parts.slice(1).map((p) => (
            <span key={p} className="text-ink-muted">
              {" "}
              · {p}
            </span>
          ))}
        </span>
        <SlidersHorizontal size={16} aria-hidden className="text-ink-muted" />
      </button>
      <dialog ref={ref} aria-label="Choose what the Dashboard shows" className="sheet">
        <div className="space-y-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Show</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="press -mr-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink">
              <X size={18} />
            </button>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Period</p>
            <TimeframeToggle value={timeframe} onChange={onTimeframe} fill />
          </div>
          {me?.admin && (
            <>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Bets</p>
                <ModeToggle fill />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Shown in</p>
                <UnitToggle fill />
              </div>
            </>
          )}
          <button type="button" onClick={() => ref.current?.close()} className="press min-h-11 w-full rounded-md bg-accent px-3 text-sm font-semibold text-accent-ink">
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}

export { TIMEFRAMES };
