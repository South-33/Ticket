import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { SmoothScroll } from "@/components/smooth-scroll";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASCII / AURA",
  description: "Aura Prime generative interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <SmoothScroll>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </SmoothScroll>
      </body>
    </html>
  );
}
