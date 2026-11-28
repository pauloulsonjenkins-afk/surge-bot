import { redirect } from "next/navigation";
import { isAdmin, publicViewOn } from "@/server/access";

/** The site's front door: the admin starts on Home, visitors on the Dashboard while Public view is on, anyone else at the admin sign-in. */
export default async function TabsIndexPage() {
  if (await isAdmin()) redirect("/more/admin/today");
  redirect((await publicViewOn()) ? "/dashboard" : "/more/admin/login");
}
