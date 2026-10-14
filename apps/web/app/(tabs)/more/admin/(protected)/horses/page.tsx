"use client";

import { TabbedPage } from "@/components/admin/TabbedPage";
import HorsesTodayView from "@/components/admin/views/HorsesTodayView";
import HorseLogView from "@/components/admin/views/HorseLogView";
import HorseStatsView from "@/components/admin/views/HorseStatsView";

/** Horses, the separate racing log, in one place: today's bets, every day's log, and how it's going. */
export default function HorsesPage() {
  return (
    <TabbedPage
      label="Horses"
      tabs={[
        { id: "today", label: "Today's bets", render: () => <HorsesTodayView /> },
        { id: "log", label: "Log", render: () => <HorseLogView /> },
        { id: "stats", label: "How it's going", render: () => <HorseStatsView /> },
      ]}
    />
  );
}
