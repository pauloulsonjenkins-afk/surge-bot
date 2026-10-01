"use client";

import { useDeleteStrategy } from "@/queries/use-strategies";
import { useDialog } from "@/components/ui/ConfirmDialog";

/**
 * The delete flow for a strategy, shared by the Strategies page and the Sending page so both do exactly
 * the same thing: a confirmation that says what will be deleted, then a question about ignoring new alerts.
 */
export function useDeleteStrategyFlow() {
  const remove = useDeleteStrategy();
  const dialog = useDialog();

  async function run(label: string, info: { alerts?: number; sent?: number } = {}) {
    const alerts = info.alerts;
    const sent = info.sent ?? 0;
    const ok = await dialog.confirm({
      title: `Delete “${label}”?`,
      tone: "danger",
      confirmLabel: alerts !== undefined ? `Delete ${alerts} alert${alerts === 1 ? "" : "s"}` : "Delete strategy",
      body: (
        <>
          <p>
            {alerts !== undefined ? `Its ${alerts} saved alert${alerts === 1 ? "" : "s"} are` : "Its saved alerts are"} deleted for good, so it
            disappears from the Dashboard, Live, Strategies, Trade Log and Win/Loss.
          </p>
          {sent > 0 && (
            <p>
              <strong>{sent} were already sent to bet.</strong> Those are kept as records but taken out of every result and figure (unless sent in
              the last 2 hours), and can be put back from the Results page.
            </p>
          )}
          <p>Nothing changes in your betting software. To combine it with another strategy instead, use “Merge” on the Strategies page.</p>
        </>
      ),
    });
    if (!ok) return;
    // New alerts with this name would otherwise bring the strategy straight back.
    const ignoreFuture = await dialog.confirm({
      title: `Also ignore new “${label}” alerts?`,
      confirmLabel: "Ignore new alerts",
      cancelLabel: "Let them in",
      body: (
        <>
          <p>Ignoring them keeps this strategy gone. Letting them in means it reappears when the next one arrives.</p>
          <p>You can stop ignoring it later from the bottom of the Strategies page.</p>
        </>
      ),
    });
    // Sent picks are normally kept as records, which is why a strategy that has sent bets can still show in the lists.
    const includeSent =
      sent > 0 &&
      (await dialog.confirm({
        title: `Also delete the ${sent} sent record${sent === 1 ? "" : "s"}?`,
        tone: "danger",
        confirmLabel: `Delete ${sent} sent record${sent === 1 ? "" : "s"}`,
        cancelLabel: "Keep as records",
        body: (
          <>
            <p>Deleting them makes “{label}” disappear completely from every list. Nothing changes in your betting software.</p>
            <p>Records of picks sent today are kept until tomorrow, because they count towards today’s daily limit.</p>
          </>
        ),
      }));
    remove.mutate(
      { label, ignoreFuture, includeSent },
      {
        onSuccess: (r) => {
          const parts = [`${r.removed} alert${r.removed === 1 ? "" : "s"} deleted.`];
          if ((r.sentRecordsDeleted ?? 0) > 0) parts.push(`${r.sentRecordsDeleted} sent record${r.sentRecordsDeleted === 1 ? "" : "s"} deleted.`);
          if (r.keptBecauseSent > 0) {
            const hidden = r.hiddenFromResults ?? 0;
            parts.push(`${r.keptBecauseSent} already sent to bet: kept as records, ${hidden} taken out of your results.`);
            if (hidden < r.keptBecauseSent) parts.push("Any sent in the last 2 hours still count. Delete again later to clear them.");
          }
          if (r.ignoring) parts.push("New alerts with this name will be ignored.");
          void dialog.notify({
            title: `“${label}” deleted`,
            body: (
              <>
                {parts.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </>
            ),
          });
        },
      },
    );
  }

  return { run, isPending: remove.isPending, error: remove.error };
}
