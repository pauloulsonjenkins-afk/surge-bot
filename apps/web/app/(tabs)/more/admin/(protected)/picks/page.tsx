import { redirect } from "next/navigation";

/** The raw alerts now sit on a tab of Amend results. Kept so old links and bookmarks still land somewhere. */
export default function PicksPage() {
  redirect("/more/admin/results?view=raw");
}
