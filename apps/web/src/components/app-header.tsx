"use client";

import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { Icons } from "@/components/icons";
import { Logo } from "@/components/logo";

export function AppHeader(): ReactElement {
  const pathname = usePathname();
  const status = pathname === "/" ? "ready" : "hosted";

  return (
    <header className="appbar">
      <Logo />
      <nav className="appnav">
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
