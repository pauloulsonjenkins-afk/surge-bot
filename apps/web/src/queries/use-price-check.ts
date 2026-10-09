"use client";

import { useQuery } from "@tanstack/react-query";
import type { PriceCheckReport, PriceCheckRow } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { PriceCheckReport, PriceCheckRow };

export function usePriceCheck(days: number, enabled: boolean) {
  return useQuery({
    queryKey: ["price-check", days],
    queryFn: ({ signal }) => getJson<PriceCheckReport>(`/api/admin/price-check?days=${days}`, "the price check", signal),
    enabled,
    staleTime: 60_000,
  });
}
