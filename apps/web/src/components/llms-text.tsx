/**
 * Renders llms.txt content in monospace with light markdown highlighting:
 * headings bold, blockquote italic, link labels accented. Pure and testable.
 */
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

function renderInline(line: string, key: number) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    parts.push(
      <span key={`${key}-${match.index}`}>
        [<span className="text-accent">{match[1]}</span>](
        <span className="text-ink-soft">{match[2]}</span>)
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.length ? parts : line;
}

export function LlmsText({ content }: { content: string }) {
  const lines = content.replace(/\n$/, "").split("\n");
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-6">
      {lines.map((line, i) => {
        let className = "";
        if (/^#\s/.test(line)) className = "font-semibold text-lg";
        else if (/^##\s/.test(line)) className = "font-semibold";
        else if (/^>\s?/.test(line)) className = "italic text-ink-soft";
        return (
          <div key={i} className={className}>
            {renderInline(line, i)}
            {line === "" ? " " : null}
          </div>
        );
      })}
    </pre>
  );
}
