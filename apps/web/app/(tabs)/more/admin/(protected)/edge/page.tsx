"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { EdgeList } from "@/components/edge/EdgeList";
import { getJson } from "@/queries/fetch-json";
import type { EdgeCard } from "@/lib/members/edge";

/** The admin's view of Edge: the same cards paid and trial members see on Members > Fixtures. */
export default function AdminEdgePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-edge"],
    queryFn: ({ signal }) => getJson<{ cards: EdgeCard[] }>("/api/admin/edge", "the Edge cards", signal),
    refetchInterval: 10 * 60_000,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        as="h2"
        title="Fixtures · Edge"
        subtitle="The pre-match insight cards members see (paid and trial; change who on Members), for every fixture in the next 48 hours in the 38 football-data leagues. Worked out every 6 hours; read-only, nothing here bets."
      />
      {error ? <QueryError error={error} next="/more/admin/edge" /> : isLoading || !data ? <Skeleton className="h-96 w-full" /> : <EdgeList cards={data.cards} />}
    </div>
  );
}
