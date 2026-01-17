import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  title: "物欲王 - すべてのほしいものを一つに",
  description: "複数のECサイトのほしいものリストを一元管理",
  manifest: "/manifest.json",
  themeColor: "#f59e0b",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "物欲王",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="antialiased">
        <SessionProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
