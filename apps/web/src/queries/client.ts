import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // dashboard numbers don't need to refetch on every focus
        refetchOnWindowFocus: false,
        // Polling stops while the tab is hidden (TanStack's default, kept explicit): a forgotten tab costs nothing.
        refetchIntervalInBackground: false,
        retry: 1,
      },
    },
  });
}
