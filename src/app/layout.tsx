import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { SmoothScroll } from "@/components/smooth-scroll";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASCII / AURA",
  description: "Aura Prime generative interface",
};
const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {hasClerk && (
          <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
            <SmoothScroll>
              <ConvexClientProvider>{children}</ConvexClientProvider>
            </SmoothScroll>
          </ClerkProvider>
        )}
        {!hasClerk && (
          <SmoothScroll>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </SmoothScroll>
        )}
      </body>
    </html>
  );
}
