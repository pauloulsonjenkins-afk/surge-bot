import { redirect } from "next/navigation";

/** The only sign-in is the admin's. Kept so old links still land on it. */
export default function LoginMoved() {
  redirect("/more/admin/login");
}
