import { marked, type Token, type Tokens } from 'marked';

const MAX_BLOCKS = 50;
const SECTION_LIMIT = 3000;
const HEADER_LIMIT = 150;

export type SlackBlock = { type: string; [k: string]: unknown };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    const a = t as any;
    switch (t.type) {
      case 'text': out += a.tokens?.length ? inline(a.tokens) : esc(a.text ?? ''); break;
      case 'escape': out += esc(a.text ?? ''); break;
      case 'strong': out += `*${inline(a.tokens)}*`; break;
      case 'em': out += `_${inline(a.tokens)}_`; break;
      case 'del': out += `~${inline(a.tokens)}~`; break;
      case 'codespan': out += `\`${a.text ?? ''}\``; break;
      case 'br': out += '\n'; break;
      case 'link': out += `<${a.href}|${inline(a.tokens) || esc(a.text ?? '')}>`; break;
      case 'image': out += `<${a.href}|${esc(a.text || 'image')}>`; break;
      case 'html': {
        const tag = (a.text ?? '').trim().toLowerCase();
        if (tag === '<br>' || tag === '<br/>' || tag === '<br />') out += '\n';
        break;
      }
      default: if (typeof a.text === 'string') out += esc(a.text);
    }
  }
  return out;
}

function plain(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    const a = t as any;
    if (Array.isArray(a.tokens)) out += plain(a.tokens);
    else if (typeof a.text === 'string') out += a.text;
  }
  return out;
}

function chunk(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length) parts.push(rest);
  return parts;
}

function pushSection(md: string, out: SlackBlock[]): void {
  for (const part of chunk(md, SECTION_LIMIT)) {
    out.push({ type: 'section', text: { type: 'mrkdwn', text: part } });
  }
}

function pushCode(code: string, out: SlackBlock[]): void {
  // KNOWN LIMITATION: if `code` itself contains a triple-backtick sequence, Slack's
  // mrkdwn parser treats it as a closing fence and misrenders the remainder. We do
  // NOT sanitize it (injecting chars would corrupt code a user copies). A future fix
  // would emit a rich_text_preformatted block instead of an mrkdwn code section.
  for (const part of chunk(code, SECTION_LIMIT - 8)) {
    out.push({ type: 'section', text: { type: 'mrkdwn', text: '```\n' + part + '\n```' } });
  }
}

function headerBlock(text: string): SlackBlock {
  const t = text.length > HEADER_LIMIT ? text.slice(0, HEADER_LIMIT - 1) + '…' : text;
  return { type: 'header', text: { type: 'plain_text', text: t, emoji: true } };
}

function renderList(list: Tokens.List, depth = 0): string {
  const indent = '    '.repeat(depth);
  const start = typeof list.start === 'number' ? list.start : 1;
  const lines: string[] = [];
  list.items.forEach((item, i) => {
    const bullet = list.ordered ? `${start + i}.` : '•';
    let text = '';
    const nested: string[] = [];
    for (const tok of item.tokens as Token[]) {
      const a = tok as any;
      if (tok.type === 'list') nested.push(renderList(tok as Tokens.List, depth + 1));
      else if (tok.type === 'text') text += a.tokens ? inline(a.tokens) : esc(a.text ?? '');
      else if (tok.type === 'paragraph') text += inline(a.tokens);
      else if (typeof a.text === 'string') text += esc(a.text);
    }
    lines.push(`${indent}${bullet} ${text}`.trimEnd());
    for (const n of nested) lines.push(n);
  });
  return lines.join('\n');
}

function renderBlockquote(bq: Tokens.Blockquote): string {
  const parts: string[] = [];
  for (const tok of bq.tokens as Token[]) {
    const a = tok as any;
    if (tok.type === 'paragraph') parts.push(inline(a.tokens));
    else if (tok.type === 'text') parts.push(a.tokens ? inline(a.tokens) : esc(a.text ?? ''));
    else if (Array.isArray(a.tokens)) parts.push(inline(a.tokens));
    else if (typeof a.text === 'string') parts.push(esc(a.text));
  }
  return parts.join('\n').split('\n').map((l) => `> ${l}`).join('\n');
}

function renderTable(tbl: Tokens.Table): string {
  const head = tbl.header.map((c) => plain((c as any).tokens)).join(' | ');
  const rows = tbl.rows.map((r) => r.map((c) => plain((c as any).tokens)).join(' | '));
  return [head, ...rows].join('\n');
}

function pushToken(t: Token, out: SlackBlock[]): void {
  const a = t as any;
  switch (t.type) {
    case 'space': break;
    case 'heading':
      if (a.depth <= 2) out.push(headerBlock(plain(a.tokens)));
      else pushSection(`*${inline(a.tokens)}*`, out);
      break;
    case 'paragraph': pushSection(inline(a.tokens), out); break;
    case 'text': {
      const md = a.tokens ? inline(a.tokens) : esc(a.text ?? '');
      if (md.trim()) pushSection(md, out);
      break;
    }
    case 'list': pushSection(renderList(t as Tokens.List), out); break;
    case 'code': pushCode(a.text ?? '', out); break;
    case 'blockquote': pushSection(renderBlockquote(t as Tokens.Blockquote), out); break;
    case 'hr': out.push({ type: 'divider' }); break;
    case 'table': pushCode(renderTable(t as Tokens.Table), out); break;
    case 'html': break;
    default: if (typeof a.text === 'string' && a.text.trim()) pushSection(esc(a.text), out);
  }
}

/** CommonMark (marked) won't treat `** text **` as bold — emphasis delimiters can't hug
 *  whitespace — so the literal `**` leaks straight through to Slack. LLMs routinely pad bold
 *  like this. Tighten the spacing just inside a paired `**…**` run (single line, no inner `*`)
 *  so it parses as real bold and renders as Slack's single-`*`. A lone/unpaired `**` (e.g. a
 *  glob like double-star-slash) has no closing run on the line and is left untouched. */
function tightenBold(md: string): string {
  return md.replace(/\*\*[ \t]*([^*\n]+?)[ \t]*\*\*/g, '**$1**');
}

/** Convert Markdown into a Slack Block Kit blocks array. */
export function markdownToBlocks(md: string): SlackBlock[] {
  const tokens = marked.lexer(tightenBold(md ?? ''));
  const blocks: SlackBlock[] = [];
  for (const t of tokens) pushToken(t, blocks);
  if (blocks.length > MAX_BLOCKS) {
    const kept = blocks.slice(0, MAX_BLOCKS - 1);
    kept.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_…message truncated_' }] });
    return kept;
  }
  return blocks;
}

/** Plain-text fallback for the Slack message `text` field (notifications/accessibility). */
export function markdownToFallbackText(md: string, limit = 3000): string {
  const text = (md ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}
