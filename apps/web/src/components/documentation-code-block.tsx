"use client";

import type { JSX } from "react";
import { CopyButton } from "@/components/copy-button";

export function DocumentationCodeBlock({
  children,
  label,
  copy = true,
}: {
  children: string;
  label?: string;
  copy?: boolean;
}): JSX.Element {
  const showHead = copy || Boolean(label);
  return (
    <figure className="docs-code-wrap">
      {showHead ? (
        <figcaption className="docs-code-head">
          <span className="docs-code-label">{label}</span>
          {copy ? (
            <CopyButton text={children} label="Copy code" className="docs-code-copy" />
          ) : null}
        </figcaption>
      ) : null}
      <pre className="docs-code">
        <code>{children}</code>
      </pre>
    </figure>
  );
}
