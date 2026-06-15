/**
 * Renders llms.txt content as a line-numbered, syntax-highlighted code view.
 * Headings, blockquotes, and markdown links are tokenized for the dark theme.
 * Pure and testable.
 */
import type { ReactElement, ReactNode } from "react";

const LINK_LINE_RE = /^(\s*-\s)\[([^\]]+)\]\(([^)]+)\)(:?)(.*)$/;

function highlightLine(line: string): ReactNode {
  if (/^#\s/.test(line)) return <span className="tok-h1">{line}</span>;
  if (/^##\s/.test(line)) return <span className="tok-h2">{line}</span>;
  if (/^>\s?/.test(line)) return <span className="tok-quote">{line}</span>;

  const match = LINK_LINE_RE.exec(line);
  if (match) {
    return (
      <>
        <span className="tok-bullet">{match[1]}</span>
        <span className="tok-link">[{match[2]}]</span>
        <span className="tok-url">({match[3]})</span>
        <span className="tok-colon">{match[4]}</span>
        <span className="tok-desc">{match[5]}</span>
      </>
    );
  }

  if (/^\s*-\s/.test(line)) {
    const idx = line.indexOf("- ") + 2;
    return (
      <>
        <span className="tok-bullet">{line.slice(0, idx)}</span>
        {line.slice(idx)}
      </>
    );
  }

  return <span className="tok-text">{line}</span>;
}

export function LlmsText({ content }: { content: string }): ReactElement {
  const lines = content.replace(/\n$/, "").split("\n");
  return (
    <div className="code">
      {lines.map((line, i) => (
        <div className="code-row" key={i}>
          <span className="code-ln">{i + 1}</span>
          <span className="code-line">{line === "" ? " " : highlightLine(line)}</span>
        </div>
      ))}
    </div>
  );
}
