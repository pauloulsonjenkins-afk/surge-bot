"use client";

import { useDeleteStrategy } from "@/queries/use-strategies";

/**
 * The delete flow for a strategy, shared by the Strategies page and the Sending page so both do exactly
 * the same thing: a confirmation that says what will be deleted, then a question about ignoring new alerts.
 */
export function useDeleteStrategyFlow() {
  const remove = useDeleteStrategy();

  function run(label: string, info: { alerts?: number; sent?: number } = {}) {
    const alerts = info.alerts;
    const sent = info.sent ?? 0;
    const ok = window.confirm(
      `Delete “${label}”?\n\n` +
        (alerts !== undefined
          ? `Its ${alerts} saved alert${alerts === 1 ? "" : "s"} are deleted for good, so it disappears from the Dashboard, Live, Strategies, Trade Log and Win/Loss.`
          : `Its saved alerts are deleted for good, so it disappears from the Dashboard, Live, Strategies, Trade Log and Win/Loss.`) +
        (sent > 0
          ? `\n\n${sent} of them were already sent to bet. Those are kept as records but taken out of every result and figure (unless sent in the last 2 hours), and can be put back from the Results page.`
          : "") +
        `\n\nNothing changes in your betting software. If you only want to combine it with another strategy, use “Merge” on the Strategies page instead.`,
    );
    if (!ok) return;
    // New alerts with this name would otherwise bring the strategy straight back.
    const ignoreFuture = window.confirm(
      `Also ignore new “${label}” alerts?\n\nOK = ignore them from now on, so this strategy stays gone.\nCancel = let new ones in, and it will reappear when one arrives.\n\nYou can stop ignoring it later from the bottom of the Strategies page.`,
    );
    remove.mutate(
      { label, ignoreFuture },
      {
        onSuccess: (r) => {
          const parts = [`${r.removed} alert${r.removed === 1 ? "" : "s"} deleted.`];
          if (r.keptBecauseSent > 0) {
            const hidden = r.hiddenFromResults ?? 0;
            parts.push(`${r.keptBecauseSent} already sent to bet: kept as records, ${hidden} taken out of your results.`);
            if (hidden < r.keptBecauseSent) parts.push("Any sent in the last 2 hours still count. Delete again later to clear them.");
          }
          if (r.ignoring) parts.push("New alerts with this name will be ignored.");
          window.alert(parts.join("\n"));
        },
      },
    );
  }

  return { run, isPending: remove.isPending, error: remove.error };
}
