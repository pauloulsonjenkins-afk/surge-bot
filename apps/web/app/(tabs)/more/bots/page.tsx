import { redirect } from "next/navigation";

// The hit-rate cards now live on the admin Strategies page. This keeps old bookmarks working.
export default function OldStrategiesPage() {
  redirect("/more/admin/strategies");
}
