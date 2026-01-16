import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  title: "物欲王 - すべてのほしいものを一つに",
  description: "複数のECサイトのほしいものリストを一元管理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
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
