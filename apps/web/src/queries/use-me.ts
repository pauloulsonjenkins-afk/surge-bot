"use client";

import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getJson } from "./fetch-json";
import type { UserPage } from "@/lib/user-pages";

export interface Me {
  admin: boolean;
  publicView: boolean;
  user: { id: number; email: string; name: string; pages: UserPage[]; active: boolean } | null;
  /** The page groups this visitor can open right now. */
  pages: UserPage[];
}

export const ME_KEY = ["me"];

const noSubscribe = () => () => {};

/** False while the server's HTML is being hydrated, true from then on (and straight away on later client renders). */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

export function useMe() {
  const hydrated = useHydrated();
  const query = useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => getJson<Me>("/api/auth/me", "your account", signal),
    staleTime: 15_000,
  });
  // The server never knows who is signed in, so until the page has hydrated, report "not known yet" just as the server
  // rendered it. Otherwise an answer that arrives mid-hydration draws admin-only parts (the All / Live / Sim switch)
  // the server's HTML didn't have, React reports a hydration mismatch, and it throws the page away and redraws it.
  return hydrated ? query : ({ ...query, data: undefined, isLoading: true } as typeof query);
}

/** Signs the website user out and forgets everything that was loaded while they were signed in. */
export function useSignOut(to = "/members") {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "DELETE" });
    },
    onSettled: () => {
      qc.clear();
      router.replace(to);
      router.refresh();
    },
  });
}
