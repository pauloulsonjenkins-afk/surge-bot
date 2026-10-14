"use client";

import { TabbedPage } from "@/components/admin/TabbedPage";
import LeaguesView from "@/components/admin/views/LeaguesView";
import LeagueHistoryView from "@/components/admin/views/LeagueHistoryView";

/** Leagues: which leagues count (hide, reset, country, tier), and how each one has played over past seasons. */
export default function LeaguesPage() {
  return (
    <TabbedPage
      label="Leagues"
      tabs={[
        { id: "manage", label: "Our leagues", render: () => <LeaguesView /> },
        { id: "history", label: "Past seasons", render: () => <LeagueHistoryView /> },
      ]}
    />
  );
}
