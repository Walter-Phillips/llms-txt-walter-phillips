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

  async function writeClipboard(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  async function copyText(): Promise<void> {
    if (await writeClipboard(text)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
      }, 1600);
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
