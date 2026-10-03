"use client";

import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./client";
import { keepCache, restoreCache } from "./persist";
import { DialogProvider } from "@/components/ui/ConfirmDialog";

export default function Providers({ children }: { children: React.ReactNode }) {
  // useState (not a module-level singleton) so each browser session gets its
  // own client and server-rendered markup is never shared between users.
  const [client] = useState(createQueryClient);
  // The last figures come back from the browser once the page has hydrated (see persist.ts), then fresh ones replace them.
  useEffect(() => {
    restoreCache(client);
    return keepCache(client);
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      <DialogProvider>{children}</DialogProvider>
    </QueryClientProvider>
  );
}
