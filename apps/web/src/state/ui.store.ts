import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;

  /** Last non-admin sub-route visited under /more, so re-opening the tab returns there. */
  lastMoreRoute: string;
  setLastMoreRoute: (path: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      setTheme: (theme) => set({ theme }),

      lastMoreRoute: "/more",
      setLastMoreRoute: (lastMoreRoute) => set({ lastMoreRoute }),
    }),
    {
      name: "surge-ui", // localStorage key
      partialize: (s) => ({ theme: s.theme, lastMoreRoute: s.lastMoreRoute }),
    }
  )
);
