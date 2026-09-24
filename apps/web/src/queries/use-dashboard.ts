"use client";

import { useQuery } from "@tanstack/react-query";
import { Timeframe } from "@/domain/dashboard";
import { generateOpenPositions, generateTrades, getWindow } from "@/lib/mock/generate";
import { deriveBotPerformance, deriveLeagueBreakdown, deriveSeries, deriveSummary } from "@/lib/mock/derive";
import { dashboardKeys } from "./keys";

/** Stands in for network latency so loading skeletons are exercised honestly. */
function settle<T>(value: T, ms = 450): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function useDashboardSummary(timeframe: Timeframe) {
  return useQuery({
    queryKey: dashboardKeys.summary(timeframe),
    queryFn: () => {
      const trades = generateTrades(timeframe, 0);
      const prevTrades = generateTrades(timeframe, 1);
      const openPositions = generateOpenPositions();
      return settle(deriveSummary(trades, prevTrades, openPositions));
    },
  });
}

export function usePnlRoiSeries(timeframe: Timeframe) {
  return useQuery({
    queryKey: dashboardKeys.pnlRoi(timeframe),
    queryFn: () => {
      const trades = generateTrades(timeframe, 0);
      const { start, end } = getWindow(timeframe, 0);
      return settle(deriveSeries(trades, timeframe, start, end));
    },
  });
}

export function useLeagueBreakdown(timeframe: Timeframe) {
  return useQuery({
    queryKey: dashboardKeys.leagueBreakdown(timeframe),
    queryFn: () => {
      const trades = generateTrades(timeframe, 0);
      const prevTrades = generateTrades(timeframe, 1);
      return settle(deriveLeagueBreakdown(trades, prevTrades));
    },
  });
}

export function useBotPerformance(timeframe: Timeframe) {
  return useQuery({
    queryKey: dashboardKeys.botPerformance(timeframe),
    queryFn: () => {
      const trades = generateTrades(timeframe, 0);
      const prevTrades = generateTrades(timeframe, 1);
      const { start, end } = getWindow(timeframe, 0);
      return settle(deriveBotPerformance(trades, timeframe, start, end, undefined, prevTrades));
    },
  });
}
