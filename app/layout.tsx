import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display, JetBrains_Mono } from "next/font/google";
import { APP_INFO, pageTitle } from "@/config";
import { TRPCReactProvider } from "@/lib/trpc/react";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import "./globals.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const serif = DM_Serif_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: pageTitle(), template: `%s · ${APP_INFO.name}` },
  description: APP_INFO.tagline,
  metadataBase: new URL(APP_INFO.productionUrl),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
    >
      <body>
        <PostHogProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
