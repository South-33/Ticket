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
          <ClerkProvider
            publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
            appearance={{
              variables: {
                colorPrimary: "#111111",
                colorBackground: "#f4f4f0",
                colorText: "#111111",
                colorTextSecondary: "#777777",
                colorInputBackground: "transparent",
                colorInputText: "#111111",
                colorDanger: "#9a3b2f",
                colorSuccess: "#635b2f",
                fontFamily: "var(--font-mono)",
                borderRadius: "0",
              },
              elements: {
                cardBox: "brutalist-clerk-card-box",
                card: "brutalist-clerk-card",
                headerTitle: "brutalist-clerk-header",
                headerSubtitle: "brutalist-clerk-subtitle",
                socialButtonsBlockButton: "brutalist-clerk-social-btn",
                socialButtonsBlockButtonText: "brutalist-clerk-social-btn-text",
                dividerRow: "brutalist-clerk-divider",
                dividerText: "brutalist-clerk-divider-text",
                formFieldLabel: "brutalist-clerk-label",
                formFieldInput: "brutalist-clerk-input",
                formButtonPrimary: "brutalist-clerk-primary-btn",
                footerActionText: "brutalist-clerk-footer-text",
                footerActionLink: "brutalist-clerk-footer-link",
                identityPreviewText: "brutalist-clerk-preview",
                identityPreviewEditButtonIcon: "brutalist-clerk-preview-btn",
                formFieldInputShowPasswordButton: "brutalist-clerk-password-btn",
                userButtonPopoverCard: "brutalist-clerk-card",
                logoImage: "brutalist-clerk-logo",
              }
            }}
          >
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
