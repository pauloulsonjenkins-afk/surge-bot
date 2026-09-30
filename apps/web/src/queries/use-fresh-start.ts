"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiFetchError, getJson } from "./fetch-json";

const KEY = ["fresh-start"];

/** The time figures are counted from, or null when they count from the very beginning. */
export function useFreshStart() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await getJson<{ at: string | null }>("/api/admin/fresh-start", "the fresh start setting")).at,
    staleTime: 0,
  });
}

export function useSetFreshStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (start: boolean): Promise<string | null> => {
      const res = await fetch("/api/admin/fresh-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      }
      return ((await res.json()) as { at: string | null }).at;
    },
    // Every figure on the site changes, so everything already loaded is refetched.
    onSuccess: (at) => {
      qc.setQueryData(KEY, at);
      void qc.invalidateQueries();
    },
  });
}
