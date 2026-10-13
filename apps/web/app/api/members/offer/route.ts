import { forPublic } from "@/server/members-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What sign-up offers (trial length, strategies, whether memberships are on sale), for signed-out visitors. */
export async function GET() {
  return forPublic("offer");
}
