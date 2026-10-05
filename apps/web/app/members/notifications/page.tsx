"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMembersAction, useMembersNotifications } from "@/queries/use-members";
import { when } from "@/components/members/ui";

export default function NotificationsPage() {
  const { data, isLoading } = useMembersNotifications();
  const read = useMembersAction("notifications/read");
  const unread = data?.unread ?? 0;
  const markRead = read.mutate;
  // Opening the page marks everything read.
  useEffect(() => {
    if (unread > 0) markRead({});
  }, [unread, markRead]);
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Notifications" />
      <Card>
        {data.notifications.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.notifications.map((n) => (
              <li key={n.id} className="py-2">
                <p className={`text-sm ${n.readAt ? "text-ink" : "font-semibold text-ink"}`}>{n.title}</p>
                <p className="text-sm text-ink-muted">{n.body}</p>
                <p className="text-xs text-ink-muted">
                  {when(n.at)}
                  {n.link?.startsWith("/members") && (
                    <>
                      {" · "}
                      <Link href={n.link} className="text-accent">
                        Open
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
