import { redirect } from "next/navigation";

/** Direct betting now sits on the Sending page (and its webhook alerts on Settings). Kept so old links still land somewhere. */
export default function DirectMoved() {
  redirect("/more/admin/sending");
}
