"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      throw new Error(
        "NEXT_PUBLIC_CONVEX_URL is missing. Add it to .env.local before running the app.",
      );
    }
    return new ConvexReactClient(convexUrl);
  }, []);

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
