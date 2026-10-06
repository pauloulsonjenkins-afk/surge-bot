import { redirect } from "next/navigation";

/** Sign-in lives in the Members area now. Kept so old links (with ?next=) still land there. */
export default async function LoginMoved({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  redirect(next ? `/members/login?next=${encodeURIComponent(next)}` : "/members/login");
}
