"use client";

import { useQuery } from "@tanstack/react-query";
import type { ScheduleDay, ScheduleFixture } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { ScheduleDay, ScheduleFixture };
export type ScheduleWhen = "today" | "tomorrow";

export function useSchedule(when: ScheduleWhen) {
  return useQuery({
    queryKey: ["schedule", when],
    queryFn: ({ signal }) => getJson<ScheduleDay>(`/api/schedule${when === "tomorrow" ? "?day=tomorrow" : ""}`, "the schedule", signal),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
