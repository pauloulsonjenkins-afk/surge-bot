"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiFetchError, getJson } from "./fetch-json";

const KEY = ["admin-access"];

export function usePublicView() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await getJson<{ publicView: boolean }>("/api/admin/access", "the public view setting")).publicView,
    staleTime: 0,
  });
}

export function useSetPublicView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (publicView: boolean): Promise<boolean> => {
      const res = await fetch("/api/admin/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicView }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      }
      return ((await res.json()) as { publicView: boolean }).publicView;
    },
    onSuccess: (value) => qc.setQueryData(KEY, value),
  });
}
