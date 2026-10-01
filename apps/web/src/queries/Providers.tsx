"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./client";
import { DialogProvider } from "@/components/ui/ConfirmDialog";

export default function Providers({ children }: { children: React.ReactNode }) {
  // useState (not a module-level singleton) so each browser session gets its
  // own client and server-rendered markup is never shared between users.
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <DialogProvider>{children}</DialogProvider>
    </QueryClientProvider>
  );
}
