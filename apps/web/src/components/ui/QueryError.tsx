import Link from "next/link";
import { ApiFetchError } from "@/queries/fetch-json";

/**
 * Shown when a page's data request fails.
 *  401 = not signed in: offer the admin sign-in (the only one since the Members area went, 14 Nov 2026).
 *  403 = signed in, but this page is the admin's.
 */
export function QueryError({ error, next }: { error: Error; next: string }) {
  if (error instanceof ApiFetchError && error.status === 401) {
    return (
      <p className="text-sm text-ink-muted">
        Sign in to see this page.{" "}
        <Link href={`/more/admin/login?next=${encodeURIComponent(next)}`} className="text-accent underline">
          Sign in
        </Link>
      </p>
    );
  }
  if (error instanceof ApiFetchError && error.status === 403) {
    return <p className="text-sm text-ink-muted">This page is for the GoalBrew admin.</p>;
  }
  return <p className="text-sm text-destructive">{error.message}</p>;
}
