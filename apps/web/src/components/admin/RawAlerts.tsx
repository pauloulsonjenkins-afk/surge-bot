"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { useRecentPicks } from "@/queries/use-picks";

const whenFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/London",
});

/** Every alert the engine has captured, exactly as first received, most recent first. */
export function RawAlerts() {
  const { data, isLoading, error } = useRecentPicks(50);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data || data.length === 0) return <p className="text-sm text-ink-muted">No alerts captured yet.</p>;

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {data.map((p) => (
        <li key={p.id} className="space-y-1.5 px-3 py-3">
          <p className="flex items-center justify-between gap-3 text-xs text-ink-muted">
            <span className="tabular-nums">{whenFmt.format(new Date(p.receivedAt))}</span>
            <span className={p.signatureVerified ? "" : "text-warn"}>
              {p.signatureVerified ? "Signature verified" : "Signature not verified"}
            </span>
          </p>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-ink">{p.body}</pre>
        </li>
      ))}
    </ul>
  );
}
