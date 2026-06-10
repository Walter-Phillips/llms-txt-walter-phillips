import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "profound-takehome",
  description: "Agent-native Next.js project initialized by harness-init"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
