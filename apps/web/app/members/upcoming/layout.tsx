import type { Metadata } from "next";

// The page is a client component, so its browser-tab title is set here (members/layout.tsx adds " · GoalBrew").
export const metadata: Metadata = { title: "Upcoming" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
