"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useHorseBets } from "@/queries/use-horses";
import { yankees } from "@/lib/horses";
import { Analysis } from "@/components/horses/HorseAnalysis";

/** Horses: how it's going — results, charts and patterns. Today's bets are entered on the Horses page. */
export default function HorseStatsPage() {
  const { data, isLoading, error } = useHorseBets();
  const bets = useMemo(() => data?.bets ?? [], [data]);
  const allYankees = useMemo(() => yankees(data?.days ?? [], bets), [data, bets]);
  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="How it’s going"
        subtitle={
          <>
            Your horse results over time: profit, which choice is paying, courses and patterns.{" "}
            <Link href="/more/admin/horses" className="text-accent underline">
              Today’s bets
            </Link>
          </>
        }
      />
      {error ? (
        <QueryError error={error} next="/more/admin/horse-stats" />
      ) : isLoading || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Analysis bets={bets} allYankees={allYankees} />
      )}
    </div>
  );
}
