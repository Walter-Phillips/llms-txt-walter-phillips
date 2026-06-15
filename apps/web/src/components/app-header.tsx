"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { Icons } from "@/components/icons";
import { Logo } from "@/components/logo";

export function AppHeader(): ReactElement {
  const pathname = usePathname();
  const status = pathname.startsWith("/sites/") ? "hosted" : "ready";

  return (
    <header className="appbar">
      <Logo />
      <nav className="appnav">
        <Link className="appnav-link" href="/generations">
          generations
        </Link>
        <Link className="appnav-link" href="/docs">
          docs
        </Link>
        <a className="appnav-link" href="https://llmstxt.org" target="_blank" rel="noreferrer">
          spec <Icons.external size={12} />
        </a>
        <span className="appnav-sep" />
        <span className="appnav-status">
          <span className="appnav-dot" /> {status}
        </span>
      </nav>
    </header>
  );
}
