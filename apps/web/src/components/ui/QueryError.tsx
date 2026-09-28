import Link from "next/link";
import { ApiFetchError } from "@/queries/fetch-json";

/** Shown when a page's data request fails. A 401 means "not signed in", so offer the sign-in link. */
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
  return <p className="text-sm text-danger">{error.message}</p>;
}
