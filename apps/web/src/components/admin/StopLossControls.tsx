"use client";

import { useState } from "react";
import type { StopLossPatch, StopLossStatus } from "@/queries/use-sending";

const inputCls = "w-full rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink";

function money(n: number): string {
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}£${Math.abs(n).toFixed(2)}`;
}

/**
 * The stop loss for one strategy: a daily loss limit and a losing-run limit. When either is reached, new
 * picks for the strategy are held back for the rest of the UK day. Empty box = no limit of that kind.
 */
export function StopLossControls({
  status,
  busy,
  onSave,
}: {
  status: StopLossStatus | null;
  busy: boolean;
  onSave: (patch: StopLossPatch) => void;
}) {
  const savedLoss = status?.dailyLoss != null ? String(status.dailyLoss) : "";
  const savedRun = status?.lossRun != null ? String(status.lossRun) : "";
  const [loss, setLoss] = useState<string | undefined>();
  const [run, setRun] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const shownLoss = loss ?? savedLoss;
  const shownRun = run ?? savedRun;
  const dirty = shownLoss.trim() !== savedLoss || shownRun.trim() !== savedRun;
  const hasLimits = status !== null;

  function save() {
    const l = shownLoss.trim().replace(/^£/, "");
    const r = shownRun.trim();
    const lossN = l === "" ? null : Number(l);
    const runN = r === "" ? null : Number(r);
    if (lossN !== null && (!Number.isFinite(lossN) || lossN < 0.01 || lossN > 100000)) {
      setError("Daily loss must be an amount above zero, for example 10 or 7.50. Leave it empty for no limit.");
      return;
    }
    if (runN !== null && (!Number.isInteger(runN) || runN < 1 || runN > 50)) {
      setError("Losing run must be a whole number from 1 to 50. Leave it empty for no limit.");
      return;
    }
    setError(null);
    onSave({ dailyLoss: lossN, lossRun: runN });
    setLoss(undefined);
    setRun(undefined);
  }

  function resume() {
    const ok = window.confirm(
      "Resume this strategy today?\n\nThe stop loss count starts again from now, so new picks can be sent again until the limit is reached a second time. Your betting software's own loss limits still apply.",
    );
    if (ok) onSave({ resume: true });
  }

  return (
    <div className="mt-3 rounded-lg bg-surface-2 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">Stop loss</p>
        {status?.stopped && (
          <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-medium text-white">Stopped for today</span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-ink-muted">
          Stop if down (£) today
          <input
            inputMode="decimal"
            placeholder="No limit"
            className={`${inputCls} mt-1`}
            value={shownLoss}
            onChange={(e) => setLoss(e.target.value)}
          />
        </label>
        <label className="text-[11px] text-ink-muted">
          Stop after losses in a row
          <input
            inputMode="numeric"
            placeholder="No limit"
            className={`${inputCls} mt-1`}
            value={shownRun}
            onChange={(e) => setRun(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
          >
            Save stop loss
          </button>
        )}
        {status?.stopped && (
          <button
            type="button"
            onClick={resume}
            disabled={busy}
            className="rounded-md border border-line px-3 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            Resume today
          </button>
        )}
      </div>

      {hasLimits ? (
        <p className={`mt-2 text-[11px] ${status.stopped ? "text-danger" : "text-ink-muted"}`}>
          {status.stopped
            ? `Stopped: ${status.reason}`
            : status.settledToday === 0
              ? "Today: nothing settled yet from picks sent to bet."
              : `Today: ${money(status.todayNet)} from ${status.settledToday} settled pick${status.settledToday === 1 ? "" : "s"}${
                  status.todayRun > 0 ? ` · ${status.todayRun} losing in a row` : ""
                }.`}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-ink-muted">No stop loss set. Only picks actually sent to bet are counted, and it resets at UK midnight.</p>
      )}
    </div>
  );
}
