import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PickMode } from "@/server/engine-client";

interface UiState {
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;

  /** Last non-admin sub-route visited under /more, so re-opening the tab returns there. */
  lastMoreRoute: string;
  setLastMoreRoute: (path: string) => void;

  /** Admin only: whether the Dashboard, Win/Loss and Strategies show live picks, simulation picks or both. */
  pickMode: PickMode;
  setPickMode: (mode: PickMode) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      setTheme: (theme) => set({ theme }),

      lastMoreRoute: "/more",
      setLastMoreRoute: (lastMoreRoute) => set({ lastMoreRoute }),

      // Live by default: real money is what decides whether a strategy is worth betting.
      pickMode: "live",
      setPickMode: (pickMode) => set({ pickMode }),
    }),
    {
      name: "surge-ui", // localStorage key
      partialize: (s) => ({ theme: s.theme, lastMoreRoute: s.lastMoreRoute, pickMode: s.pickMode }),
      // Version 1 made Live the default: a choice saved before then (usually the old default, All) starts on Live once.
      version: 1,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<UiState>;
        return (version < 1 ? { ...s, pickMode: "live" } : s) as UiState;
      },
    }
  )
);
