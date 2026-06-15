import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/app-header";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "llms.txt generator",
  description:
    "Paste a URL, get a spec-compliant llms.txt: a plain-text map of your site for language models. Hosted, versioned, and kept up to date.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="app">
        <div className="grid-bg" aria-hidden="true" />
        <AppHeader />
        <main className="appmain">{children}</main>
      </body>
    </html>
  );
}
