import Link from "next/link";
import { ApiFetchError } from "@/queries/fetch-json";

/**
 * Shown when a page's data request fails.
 *  401 = not signed in: offer the right sign-in (admin pages use the admin password, everything else the user sign-in).
 *  403 = signed in, but this page is the admin's: members are pointed to their own area.
 */
export function QueryError({ error, next }: { error: Error; next: string }) {
  if (error instanceof ApiFetchError && error.status === 401) {
    const adminPage = next.startsWith("/more/admin");
    return (
      <p className="text-sm text-ink-muted">
        Sign in to see this page.{" "}
        <Link
          href={adminPage ? `/more/admin/login?next=${encodeURIComponent(next)}` : `/login?next=${encodeURIComponent(next)}`}
          className="text-accent underline"
        >
          Sign in
        </Link>
        {!adminPage && (
          <>
            {" "}
            or{" "}
            <Link href="/signup" className="text-accent underline">
              create an account
            </Link>
          </>
        )}
      </p>
    );
  }
  if (error instanceof ApiFetchError && error.status === 403) {
    return (
      <p className="text-sm text-ink-muted">
        This page is for the GoalBrew admin. Your strategies, results and simulation are in{" "}
        <Link href="/members" className="text-accent underline">
          Members
        </Link>
        .
      </p>
    );
  }
  return <p className="text-sm text-destructive">{error.message}</p>;
}
