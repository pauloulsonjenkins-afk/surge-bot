import { redirect } from "next/navigation";

/** The Betfair check is now a tab of Betting. Kept so old links and bookmarks still land in the right place. */
export default function Moved() {
  redirect("/more/admin/sending?tab=betfair");
}
