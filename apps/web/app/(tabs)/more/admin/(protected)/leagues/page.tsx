"use client";

import { TabbedPage } from "@/components/admin/TabbedPage";
import LeaguesView from "@/components/admin/views/LeaguesView";
import LeagueHistoryView from "@/components/admin/views/LeagueHistoryView";
import LeagueProfitView from "@/components/admin/views/LeagueProfitView";

/** Leagues: which leagues count (hide, reset, country, tier), whether each makes money (and each strategy in it), and past seasons. */
export default function LeaguesPage() {
  return (
    <TabbedPage
      label="Leagues"
      tabs={[
        { id: "manage", label: "Our leagues", render: () => <LeaguesView /> },
        { id: "profit", label: "Profit", render: () => <LeagueProfitView /> },
        { id: "history", label: "Past seasons", render: () => <LeagueHistoryView /> },
      ]}
    />
  );
}
