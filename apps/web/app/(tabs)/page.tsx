import { redirect } from "next/navigation";
import { currentUser, isAdmin, publicViewOn } from "@/server/access";

/**
 * The site's front door. The admin starts on Home; everyone, while Public view is on, starts on the Dashboard, as do
 * people the admin gave the Dashboard to. Anyone else gets the admin sign-in (the Members area was removed on
 * 14 Nov 2026).
 */
export default async function TabsIndexPage() {
  if (await isAdmin()) redirect("/more/admin/today");
  if (await publicViewOn()) redirect("/dashboard");
  const user = await currentUser();
  redirect(user?.pages.includes("dashboard") ? "/dashboard" : "/more/admin/login");
}
