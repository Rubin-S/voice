import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "VoiceStage — The Last Gate", description: "Every word has a consequence. An interactive AI character experience.", icons: { icon: "/favicon.svg" } };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
