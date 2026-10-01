"use client";

import { Card } from "@/components/ui/Card";
import { useUnplaced } from "@/queries/use-unplaced";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * Sent picks your betting software didn't place: no bet on Betfair 3 minutes after sending (last 24 hours), with the
 * likely reason. Shown only when there are some, so a quiet day adds nothing to the page.
 */
export function NotPlacedCard() {
  const { data } = useUnplaced();
  if (!data?.configured || data.picks.length === 0) return null;
  return (
    <Card
      title={<span className="text-warn">Not placed · {data.picks.length}</span>}
      subtitle={`Sent to your betting software but no bet on Betfair ${data.afterMinutes} minutes later, last 24 hours. Fix the cause in BF Bot Manager, or tick “Placed it yourself?” on Live if you bet it elsewhere.`}
    >
      <ul className="divide-y divide-line">
        {data.picks.map((p) => (
          <li key={p.id} className="py-2">
            <p className="text-sm font-medium text-ink">
              {p.match} <span className="font-normal text-ink-muted">· {p.strategy}</span>
            </p>
            <p className="text-xs text-ink-muted">
              {[p.competition, `sent ${when.format(new Date(p.sentAt))}`, p.alertedAt ? "notified" : null].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-0.5 text-xs text-ink">{p.reason}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
