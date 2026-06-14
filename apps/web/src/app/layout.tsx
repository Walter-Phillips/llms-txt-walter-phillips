import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-display"
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono"
});

export const metadata: Metadata = {
  title: "llms.txt press — generate llms.txt for any site",
  description:
    "Paste a URL, get a spec-compliant llms.txt: a plain-text map of your site for language models. Hosted, versioned, and kept up to date."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col font-mono antialiased">
        <header className="border-b border-rule">
          <div className="mx-auto flex max-w-5xl items-baseline justify-between px-6 py-4">
            <Link href="/" className="text-sm font-semibold tracking-tight hover:text-accent">
              llms.txt<span className="text-accent">_</span>press
            </Link>
            <p className="hidden text-xs uppercase tracking-[0.2em] text-ink-soft sm:block">
              plain text for language models
            </p>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-rule">
          <div className="mx-auto flex max-w-5xl items-baseline justify-between px-6 py-4 text-xs text-ink-soft">
            <span>set in plain text · no account required</span>
            <a
              href="https://llmstxt.org"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-4 hover:text-accent"
            >
              llmstxt.org spec
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
