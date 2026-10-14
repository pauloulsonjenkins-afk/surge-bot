import { redirect } from "next/navigation";

/** League history is now the "Past seasons" tab of Leagues. Kept so old links and bookmarks still land in the right place. */
export default function Moved() {
  redirect("/more/admin/leagues?tab=history");
}
