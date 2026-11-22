import type { Metadata, Viewport } from "next";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./globals.css";
import "./agenda.css";
import "@/components/home/agenda-home.css";
import "./(app)/add/agenda-add.css";
import "@/components/design/review.css";
import "@/components/design/palettes.css";
import "@/components/design/typography.css";
import { RootProviders } from "@/components/RootProviders";

export const metadata: Metadata = {
  title: "物欲王 - すべてのほしいものを一つに",
  description: "複数のECサイトのほしいものリストを一元管理",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "物欲王",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="antialiased bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
