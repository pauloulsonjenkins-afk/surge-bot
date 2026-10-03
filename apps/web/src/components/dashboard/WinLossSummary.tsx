"use client";

import type { WinLossState } from "@/queries/use-winloss";
import type { PickMode } from "@/server/engine-client";
import { getJson } from "@/queries/fetch-json";
import { usePersistedQuery } from "@/queries/persist";

/**
 * Win / loss in pounds, for the Dashboard's "Today's profit" chart. Money figures are private, so this only loads for
 * a signed-in admin: for anyone else the request is refused and the hook returns no data.
 */
export function useDashboardWinLoss(mode: PickMode = "all") {
  return usePersistedQuery({
    queryKey: ["winloss", mode],
    queryFn: ({ signal }) =>
      getJson<WinLossState>(`/api/admin/winloss${mode === "all" ? "" : `?mode=${mode}`}`, "the win/loss figures", signal),
    retry: false, // a signed-out visitor is refused once, not three times
    staleTime: 0,
    refetchInterval: 30_000,
  });
}
