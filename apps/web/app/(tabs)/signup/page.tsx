import { redirect } from "next/navigation";

/** Sign-up lives in the Members area now (/members/join). Kept so old links still land there. */
export default function SignupMoved() {
  redirect("/members/join");
}
