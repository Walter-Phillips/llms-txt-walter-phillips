import type { JSX } from "react";

export function DiffView({ diff }: { diff: string }): JSX.Element {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre
      data-testid="diff-view"
      className="overflow-x-auto whitespace-pre-wrap border border-rule bg-paper font-mono text-[13px] leading-6"
    >
      {lines.map((line, i) => {
        let className = "px-4";
        if (line.startsWith("+++") || line.startsWith("---")) {
          className += " bg-paper-deep font-semibold text-ink-soft";
        } else if (line.startsWith("@@")) {
          className += " bg-paper-deep text-accent";
        } else if (line.startsWith("+")) {
          className += " bg-moss/10 text-moss";
        } else if (line.startsWith("-")) {
          className += " bg-accent/10 text-accent";
        } else {
          className += " text-ink-soft";
        }
        return (
          <div key={i} data-diff-line={lineKind(line)} className={className}>
            {line === "" ? " " : line}
          </div>
        );
      })}
    </pre>
  );
}

function lineKind(line: string): "meta" | "hunk" | "add" | "del" | "ctx" {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}
