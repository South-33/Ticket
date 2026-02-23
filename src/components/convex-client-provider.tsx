"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode, useMemo } from "react";
import { hasConfiguredClerk } from "@/lib/clerk-env";

function useNoAuth() {
  return {
    isLoading: false,
    isAuthenticated: false,
    fetchAccessToken: async () => null,
  };
}

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

  const hasClerk = hasConfiguredClerk();
  if (!hasClerk) {
    return (
      <ConvexProviderWithAuth client={client} useAuth={useNoAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  }

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
