"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ArchiveState } from "@/server/engine-client";
import { getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { ArchiveState };

/** The archived strategies (engine archive.ts): hidden from every page, kept on record. */
export function useArchive() {
  return usePersistedQuery({
    queryKey: ["archive"],
    queryFn: ({ signal }) => getJson<ArchiveState>("/api/admin/archive", "the archive", signal),
    staleTime: 60_000,
  });
}

/** A strategy label's archive key: lower case, as the engine keys strategies. */
export const archiveKey = (label: string) => label.trim().toLowerCase();

/**
 * Whether a strategy is archived, for the pages that list strategies. Nothing is hidden while the archive loads, so a
 * slow or failed load can never make a strategy vanish.
 */
export function useIsArchived(): (label: string) => boolean {
  const { data } = useArchive();
  const set = useMemo(() => new Set(data?.keys ?? []), [data]);
  return (label: string) => set.has(archiveKey(label));
}

export function useSetArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { label: string; archived: boolean; note?: string }) => {
      const res = await fetch("/api/admin/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't change the archive.");
      return body;
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
}
