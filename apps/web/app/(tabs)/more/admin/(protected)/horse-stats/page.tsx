import { redirect } from "next/navigation";

/** "How it's going" is now a tab of Horses. Kept so old links and bookmarks still land in the right place. */
export default function Moved() {
  redirect("/more/admin/horses?tab=stats");
}
