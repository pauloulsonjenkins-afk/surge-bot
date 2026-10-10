"use client";

import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { LockedFeature } from "@/components/members/ui";
import { useMembersEdge, useMembersMe } from "@/queries/use-members";
import { EdgeList } from "@/components/edge/EdgeList";
import Link from "next/link";
import { ApiFetchError } from "@/queries/fetch-json";

/**
 * Edge: a pre-match card for each fixture in the next 48 hours. Worked out from past results a few times a day, never
 * per view. Trends are ranked by how strong they are once their sample is allowed for, and each shows its sample.
 */
export default function FixturesPage() {
  const me = useMembersMe();
  const { data, isLoading, error } = useMembersEdge();
  // Signed out, or signed in only as the admin (the admin's copy is Admin > Fixtures · Edge): say so instead of loading forever.
  if (me.error || error) {
    return (
      <p className="text-sm text-ink-muted">
        {me.error instanceof ApiFetchError && me.error.status === 401 ? (
          <>
            Sign in as a member to see Fixtures · Edge.{" "}
            <Link href="/members/login?next=/members/fixtures" className="text-accent underline">
              Sign in
            </Link>
            . The admin&apos;s copy is under Admin → Fixtures · Edge.
          </>
        ) : (
          (error ?? me.error)?.message
        )}
      </p>
    );
  }
  if (isLoading || !data || !me.data) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fixtures · Edge"
        subtitle="The strongest trends for every match in the next 48 hours, from each side's recent results and past meetings. Every line shows its sample, so you can see how much it rests on."
      />

      {data.locked ? (
        <LockedFeature
          me={me.data}
          feature="edge"
          title={`Edge insights for ${data.count ?? 0} upcoming fixture${data.count === 1 ? "" : "s"}`}
          pitch="See the headline trend for every match, plus goals, both-teams-to-score, form, runs, head-to-head and cards, each with its sample."
        />
      ) : (
        <EdgeList cards={data.cards} />
      )}
    </div>
  );
}
