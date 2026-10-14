"use client";

import { TabbedPage } from "@/components/admin/TabbedPage";
import SendingView from "@/components/admin/views/SendingView";
import ReconcileView from "@/components/admin/views/ReconcileView";

/** Betting: the bets going on Betfair now, the switches and limits behind them, and the check of Betfair's real results. */
export default function BettingPage() {
  return (
    <TabbedPage
      label="Betting"
      tabs={[
        { id: "bets", label: "Bets placed", render: () => <SendingView view="bets" /> },
        { id: "limits", label: "Limits and switches", render: () => <SendingView view="limits" /> },
        { id: "betfair", label: "Betfair check", render: () => <ReconcileView /> },
      ]}
    />
  );
}
