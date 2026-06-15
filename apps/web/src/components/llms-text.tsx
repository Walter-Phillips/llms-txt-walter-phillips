/**
 * Renders llms.txt content in monospace with light markdown highlighting:
 * headings bold, blockquote italic, link labels accented. Pure and testable.
 */
import type { ReactElement, ReactNode } from "react";

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

function renderInline(line: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    parts.push(
      <span key={`${String(key)}-${String(match.index)}`}>
        [<span className="text-accent">{match[1]}</span>](
        <span className="text-ink-soft">{match[2]}</span>)
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.length ? parts : line;
}

function lineClassName(line: string): string {
  if (/^#\s/.test(line)) return "font-semibold text-lg";
  if (/^##\s/.test(line)) return "font-semibold";
  if (/^>\s?/.test(line)) return "italic text-ink-soft";
  return "";
}

export function LlmsText({ content }: { content: string }): ReactElement {
  const lines = content.replace(/\n$/, "").split("\n");
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-6">
      {lines.map((line, i) => {
        return (
          <div key={i} className={lineClassName(line)}>
            {renderInline(line, i)}
            {line === "" ? " " : null}
          </div>
        );
      })}
    </pre>
  );
}
