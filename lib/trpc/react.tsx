"use client";

import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClient as QC,
} from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import superjson from "superjson";
import { type AppRouter } from "@/server/api/root";
import { getTrpcUrl } from "./shared";

/**
 * Client-side tRPC bindings. Wrap the app body with `<TRPCReactProvider>`
 * in `app/layout.tsx` once Stage 02 is wired everywhere.
 *
 * `superjson` matches the server transformer (Date / BigInt / Map across
 * the wire). Logger only fires in dev or on errors.
 */

export const trpc = createTRPCReact<AppRouter>();

function makeQueryClient(): QC {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Network-tolerant defaults; tighter retry on mutations.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QC | undefined;
function getQueryClient(): QC {
  if (typeof window === "undefined") {
    // RSC pass — fresh client per request to avoid cross-request leakage.
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function TRPCReactProvider(props: {
  children: React.ReactNode;
}): React.ReactElement {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchLink({
          url: getTrpcUrl(),
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
