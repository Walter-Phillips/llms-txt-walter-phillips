"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      type="button"
      variant="outline"
      className="rounded-none border-rule bg-paper font-mono text-xs uppercase tracking-wider hover:border-ink"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard unavailable (insecure context); nothing useful to do.
        }
      }}
    >
      {copied ? "Copied ✓" : label}
    </Button>
  );
}
