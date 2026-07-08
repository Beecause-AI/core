import type { ReactNode } from 'react';

/** Minimal safe markdown → JSX renderer. Supports:
 * - Headings: # ## ###
 * - Bold: **text**
 * - Italic: _text_ or *text*
 * - Inline code: `code`
 * - Fenced code blocks: ```lang\n...\n```
 * - Unordered lists: - item
 * - Ordered lists: 1. item
 * - Blockquotes: > quoted
 * - Paragraphs (blank-line separated)
 * No HTML injection — all content is text-only inside JSX nodes.
 */

function parseInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Match inline code, bold, italic in one pass
  const re = /(`[^`]+`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      // inline code
      parts.push(<code key={key++} className="rounded bg-raised px-1 py-0.5 font-mono text-sm text-fg-muted">{m[1].slice(1, -1)}</code>);
    } else if (m[2] && m[3]) {
      // **bold**
      parts.push(<strong key={key++} className="font-semibold text-fg">{m[3]}</strong>);
    } else if (m[4] && m[5]) {
      // __bold__
      parts.push(<strong key={key++} className="font-semibold text-fg">{m[5]}</strong>);
    } else if (m[6] && m[7]) {
      // *italic*
      parts.push(<em key={key++} className="italic">{m[7]}</em>);
    } else if (m[8] && m[9]) {
      // _italic_
      parts.push(<em key={key++} className="italic">{m[9]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ content }: { content: string }) {
  const nodes: ReactNode[] = [];
  const lines = content.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      i++; // skip closing ```
      nodes.push(
        <pre key={key++} className="overflow-x-auto rounded-md border border-edge bg-raised p-3 font-mono text-sm text-fg-muted">
          <code data-lang={lang || undefined}>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h3 && h3[1]) {
      nodes.push(<h3 key={key++} className="text-sm font-semibold text-fg">{parseInline(h3[1])}</h3>);
      i++;
      continue;
    }
    if (h2 && h2[1]) {
      nodes.push(<h2 key={key++} className="text-base font-semibold text-fg">{parseInline(h2[1])}</h2>);
      i++;
      continue;
    }
    if (h1 && h1[1]) {
      nodes.push(<h1 key={key++} className="text-lg font-semibold text-fg">{parseInline(h1[1])}</h1>);
      i++;
      continue;
    }

    // Unordered list block
    if (line.match(/^[-*] /)) {
      const items: ReactNode[] = [];
      while (i < lines.length && (lines[i] ?? '').match(/^[-*] /)) {
        items.push(<li key={i}>{parseInline((lines[i] ?? '').slice(2))}</li>);
        i++;
      }
      nodes.push(<ul key={key++} className="ml-4 list-disc space-y-0.5 text-sm">{items}</ul>);
      continue;
    }

    // Ordered list block
    if (line.match(/^\d+\. /)) {
      const items: ReactNode[] = [];
      while (i < lines.length && (lines[i] ?? '').match(/^\d+\. /)) {
        items.push(<li key={i}>{parseInline((lines[i] ?? '').replace(/^\d+\. /, ''))}</li>);
        i++;
      }
      nodes.push(<ol key={key++} className="ml-4 list-decimal space-y-0.5 text-sm">{items}</ol>);
      continue;
    }

    // Blockquote block: consecutive lines starting with '>' (with or without a following space).
    // Strip the marker and render the inner text inline, so a quote never shows a literal '>'.
    if (line.match(/^>\s?/)) {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] ?? '').match(/^>\s?/)) {
        quoted.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      nodes.push(
        <blockquote key={key++} className="border-l-2 border-edge pl-3 text-sm text-fg-muted">
          {parseInline(quoted.join(' '))}
        </blockquote>
      );
      continue;
    }

    // Blank line → separator (skip)
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (
        cur.trim() === '' ||
        cur.startsWith('```') ||
        cur.match(/^#{1,3} /) ||
        cur.match(/^[-*] /) ||
        cur.match(/^\d+\. /) ||
        cur.match(/^>\s?/)
      ) break;
      paraLines.push(cur);
      i++;
    }
    if (paraLines.length > 0) {
      nodes.push(
        <p key={key++} className="text-sm leading-relaxed">
          {parseInline(paraLines.join(' '))}
        </p>
      );
    }
  }

  return <div className="flex flex-col gap-2">{nodes}</div>;
}
