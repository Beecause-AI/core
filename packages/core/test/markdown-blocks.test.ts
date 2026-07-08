import { describe, expect, it } from 'vitest';
import { markdownToBlocks, markdownToFallbackText } from '../src/slack/markdown-blocks.js';

describe('markdownToBlocks', () => {
  it('converts inline formatting to mrkdwn', () => {
    const blocks = markdownToBlocks('**bold** and *italic* and ~~no~~ and `code` and [t](https://x.com)');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('*bold* and _italic_ and ~no~ and `code` and <https://x.com|t>');
  });

  it('converts whitespace-padded bold (LLM "** text **") to Slack single-* bold', () => {
    // marked alone would leak the literal ** for these; tightenBold fixes it.
    expect((markdownToBlocks('** bold **')[0] as any).text.text).toBe('*bold*');
    expect((markdownToBlocks('** bold**')[0] as any).text.text).toBe('*bold*');
    expect((markdownToBlocks('**bold **')[0] as any).text.text).toBe('*bold*');
    expect((markdownToBlocks('a ** padded ** word')[0] as any).text.text).toBe('a *padded* word');
    // already-tight bold is unchanged (idempotent)
    expect((markdownToBlocks('**bold**')[0] as any).text.text).toBe('*bold*');
  });

  it('converts h1 to a header block', () => {
    const blocks = markdownToBlocks('# Title');
    expect(blocks[0]).toEqual({ type: 'header', text: { type: 'plain_text', text: 'Title', emoji: true } });
  });

  it('converts h2 to a header block', () => {
    const blocks = markdownToBlocks('## Section');
    expect(blocks[0]).toEqual({ type: 'header', text: { type: 'plain_text', text: 'Section', emoji: true } });
  });

  it('converts h3 to a bold section', () => {
    const blocks = markdownToBlocks('### Sub');
    expect(blocks).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: '*Sub*' } }]);
  });

  it('converts unordered list to section with bullet points', () => {
    const blocks = markdownToBlocks('- a\n- b');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('• a\n• b');
  });

  it('converts ordered list to section with numbered items', () => {
    const blocks = markdownToBlocks('1. a\n2. b');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('1. a\n2. b');
  });

  it('converts fenced code block to a triple-backtick section', () => {
    const blocks = markdownToBlocks('```\nhello world\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    const text: string = (blocks[0] as any).text.text;
    expect(text.startsWith('```\n')).toBe(true);
    expect(text).toContain('hello world');
    expect(text.endsWith('\n```')).toBe(true);
  });

  it('converts hr to a divider block', () => {
    const blocks = markdownToBlocks('---');
    expect(blocks).toEqual([{ type: 'divider' }]);
  });

  it('converts blockquote to a section with > prefix', () => {
    const blocks = markdownToBlocks('> hi');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('> hi');
  });

  it('converts a table to a triple-backtick code section', () => {
    const blocks = markdownToBlocks('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    const text: string = (blocks[0] as any).text.text;
    expect(text.startsWith('```\n')).toBe(true);
    expect(text).toContain('a | b');
    expect(text).toContain('1 | 2');
    expect(text.endsWith('\n```')).toBe(true);
  });

  it('splits a paragraph longer than 3000 chars into multiple section blocks', () => {
    // Create a long paragraph with newlines so it can be split
    const longParagraph = Array.from({ length: 50 }, (_, i) => `Line ${i}: ${'x'.repeat(100)}`).join('\n');
    const blocks = markdownToBlocks(longParagraph);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect((block as any).text.text.length).toBeLessThanOrEqual(3000);
    }
  });

  it('caps output at 50 blocks with a truncation context block', () => {
    // 60 separate paragraphs (separated by blank lines)
    const input = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}`).join('\n\n');
    const blocks = markdownToBlocks(input);
    expect(blocks).toHaveLength(50);
    const last = blocks[49] as any;
    expect(last.type).toBe('context');
    expect(last.elements[0].text).toBe('_…message truncated_');
  });

  it('truncates header text longer than 150 chars', () => {
    const longTitle = 'A'.repeat(200);
    const blocks = markdownToBlocks(`# ${longTitle}`);
    expect(blocks[0]).toMatchObject({ type: 'header' });
    const text: string = (blocks[0] as any).text.text;
    expect(text.length).toBeLessThanOrEqual(150);
    expect(text.endsWith('…')).toBe(true);
  });

  it('returns empty array for empty/whitespace input', () => {
    expect(markdownToBlocks('')).toEqual([]);
    expect(markdownToBlocks('   ')).toEqual([]);
    expect(markdownToBlocks('\n\n')).toEqual([]);
  });

  it('escapes HTML special chars in text (& < >)', () => {
    const blocks = markdownToBlocks('a < b & c');
    expect(blocks).toHaveLength(1);
    const text: string = (blocks[0] as any).text.text;
    expect(text).toContain('a &lt; b &amp; c');
  });

  it('converts <br> to newline', () => {
    const blocks = markdownToBlocks('line1<br>line2');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('line1\nline2');
  });

  it('converts __bold__ to *bold*', () => {
    const blocks = markdownToBlocks('__bold__');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('*bold*');
  });

  it('converts _italic_ to _italic_', () => {
    const blocks = markdownToBlocks('_italic_');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('_italic_');
  });

  it('converts ~~strike~~ to ~strike~', () => {
    const blocks = markdownToBlocks('~~strike~~');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('~strike~');
  });

  it('converts image to <href|alt> link', () => {
    const blocks = markdownToBlocks('![alt](https://x.com/i.png)');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('<https://x.com/i.png|alt>');
  });

  it('does not escape < inside inline code', () => {
    const blocks = markdownToBlocks('`a < b`');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('`a < b`');
  });

  it('converts ordered list with non-1 start to numbered items', () => {
    const blocks = markdownToBlocks('3. a\n4. b');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    expect((blocks[0] as any).text.text).toBe('3. a\n4. b');
  });

  it('converts nested unordered list with indented bullets', () => {
    const blocks = markdownToBlocks('- a\n    - b');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
    const text: string = (blocks[0] as any).text.text;
    expect(text).toContain('• a');
    expect(text).toContain('    • b');
  });

  it('code containing triple backticks is passed through unsanitized (known Slack limitation)', () => {
    // Characterization test: documents current behavior — the inner ``` is NOT escaped.
    // A future fix would use rich_text_preformatted blocks instead.
    const innerCode = 'before\n```\nafter';
    const blocks = markdownToBlocks('```\n' + innerCode + '\n```');
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const text: string = (blocks[0] as any).text.text;
    expect(text.startsWith('```\n')).toBe(true);
    expect(text).toContain('before');
  });
});

describe('markdownToFallbackText', () => {
  it('returns plain text without markdown syntax', () => {
    const result = markdownToFallbackText('# Title\n\n**bold** text');
    expect(result).toContain('Title');
    expect(result).toContain('bold text');
    expect(result).not.toContain('#');
    expect(result).not.toContain('**');
  });

  it('truncates to the given limit', () => {
    const long = 'x'.repeat(200);
    const result = markdownToFallbackText(long, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith('…')).toBe(true);
  });

  it('defaults to 3000 char limit', () => {
    const long = 'x'.repeat(4000);
    const result = markdownToFallbackText(long);
    expect(result.length).toBeLessThanOrEqual(3000);
  });

  it('strips <br> tags and replaces them with newlines', () => {
    const result = markdownToFallbackText('line1<br>line2');
    expect(result).not.toContain('<br>');
    const lines = result.split('\n');
    expect(lines.some((l) => l.includes('line1'))).toBe(true);
    expect(lines.some((l) => l.includes('line2'))).toBe(true);
  });
});
