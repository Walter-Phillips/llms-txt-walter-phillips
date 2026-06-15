"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { Icons } from "@/components/icons";

export function CopyButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      // Clipboard unavailable (insecure context); nothing useful to do.
    }
  }

  return (
    <button
      type="button"
      className={`btn btn-ghost ${className}`}
      onClick={() => {
        void copyText();
      }}
    >
      {copied ? <Icons.check size={14} /> : <Icons.copy size={14} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
