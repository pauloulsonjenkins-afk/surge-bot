"use client";

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

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => getJson<Me>("/api/auth/me", "your account", signal),
    staleTime: 15_000,
  });
}

/** Signs the website user out and forgets everything that was loaded while they were signed in. */
export function useSignOut() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "DELETE" });
    },
    onSettled: () => {
      qc.clear();
      router.replace("/more");
      router.refresh();
    },
  });
}
