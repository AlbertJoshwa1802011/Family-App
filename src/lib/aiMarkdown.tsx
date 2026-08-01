import { Fragment, type ReactNode } from "react";

/** Bold (`**text**`) and inline code (`` `code` ``) within a line of text. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-${i}`}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code
          key={`${keyPrefix}-${i}`}
          className="rounded bg-black/25 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
    i += 1;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function isListBlock(lines: string[], marker: RegExp): boolean {
  const nonEmpty = lines.filter((l) => l.trim());
  return nonEmpty.length > 0 && nonEmpty.every((l) => marker.test(l.trim()));
}

/**
 * Minimal, dependency-free renderer for the handful of Markdown constructs an
 * assistant reply realistically uses: paragraphs, bold/code spans, bullet and
 * numbered lists, fenced code blocks, and small headings. Not a full CommonMark
 * parser by design — the goal is readable formatting, not spec compliance.
 */
export function renderAIContent(content: string): ReactNode {
  const blocks = content.trim().split(/\n{2,}/);

  return blocks.map((block, bi) => {
    const fence = block.match(/^```[\w-]*\n?([\s\S]*?)```$/);
    if (fence) {
      return (
        <pre
          key={bi}
          className="my-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs leading-relaxed"
        >
          <code>{fence[1].replace(/\n$/, "")}</code>
        </pre>
      );
    }

    const lines = block.split("\n");

    if (isListBlock(lines, /^[-*]\s+/)) {
      return (
        <ul key={bi} className="my-1 list-disc space-y-1 pl-5">
          {lines
            .filter((l) => l.trim())
            .map((l, li) => (
              <li key={li}>{renderInline(l.trim().replace(/^[-*]\s+/, ""), `${bi}-${li}`)}</li>
            ))}
        </ul>
      );
    }

    if (isListBlock(lines, /^\d+[.)]\s+/)) {
      return (
        <ol key={bi} className="my-1 list-decimal space-y-1 pl-5">
          {lines
            .filter((l) => l.trim())
            .map((l, li) => (
              <li key={li}>{renderInline(l.trim().replace(/^\d+[.)]\s+/, ""), `${bi}-${li}`)}</li>
            ))}
        </ol>
      );
    }

    const heading = block.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const text = renderInline(heading[2], `${bi}-h`);
      const size = heading[1].length === 1 ? "text-base" : "text-sm";
      return (
        <p key={bi} className={`mt-1 mb-0.5 font-semibold ${size}`}>
          {text}
        </p>
      );
    }

    return (
      <p key={bi} className="whitespace-pre-wrap">
        {lines.map((line, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(line, `${bi}-${li}`)}
          </Fragment>
        ))}
      </p>
    );
  });
}
