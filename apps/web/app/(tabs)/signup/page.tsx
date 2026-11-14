import { redirect } from "next/navigation";

/** Sign-up went with the Members area (14 Nov 2026). Kept so old links land on the sign-in. */
export default function SignupMoved() {
  redirect("/more/admin/login");
}
