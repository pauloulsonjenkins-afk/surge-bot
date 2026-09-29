"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiFetchError, getJson } from "./fetch-json";
import type { UserPage } from "@/lib/user-pages";

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  pages: UserPage[];
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUsers {
  users: AdminUser[];
  signupsOpen: boolean;
}

const KEY = ["admin-users"];

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiFetchError(data?.error ?? `Could not save (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => getJson<AdminUsers>("/api/admin/users", "the users", signal),
    staleTime: 0,
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { id: number; name?: string; pages?: UserPage[]; active?: boolean; password?: string; signOutEverywhere?: boolean }) =>
      post<{ user: AdminUser }>({ action: "update", ...patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post<{ ok: true }>({ action: "delete", id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetSignupsOpen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (open: boolean) => post<{ signupsOpen: boolean }>({ action: "signups", open }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
