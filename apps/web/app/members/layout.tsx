import type { Metadata } from "next";
import MembersShell from "@/components/members/MembersShell";

export const metadata: Metadata = { title: { default: "GoalBrew Members", template: "%s · GoalBrew" } };

/** The Members platform (beta): its own frame, separate from the main site's tabs. */
export default function MembersLayout({ children }: { children: React.ReactNode }) {
  return <MembersShell>{children}</MembersShell>;
}
