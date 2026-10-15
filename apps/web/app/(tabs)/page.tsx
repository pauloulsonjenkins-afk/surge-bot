import { redirect } from "next/navigation";
import { currentUser, isAdmin, publicViewOn } from "@/server/access";

/**
 * The site's front door. The admin starts on Today (admin only: the day's betting at a glance); everyone, while
 * Public view is on, starts on the Dashboard. Anyone else starts in Members: signed out, that is the page that
 * explains GoalBrew and offers sign-up; signed in, it is their own dashboard. People the admin gave the Dashboard to
 * before Members existed keep landing on it.
 */
export default async function TabsIndexPage() {
  if (await isAdmin()) redirect("/more/admin/today");
  if (await publicViewOn()) redirect("/dashboard");
  const user = await currentUser();
  redirect(user?.pages.includes("dashboard") ? "/dashboard" : "/members");
}
