import type { Metadata } from "next";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
