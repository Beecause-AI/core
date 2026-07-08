// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { Markdown } from '../src/components/conversation/markdown';

afterEach(cleanup);

describe('Markdown', () => {
  test('renders a blockquote without showing the literal ">" marker', () => {
    const { container } = render(<Markdown content="> a quoted line" />);
    expect(container.querySelector('blockquote')).not.toBeNull();
    // the rendered text is the inner content — no leading ">"
    expect(screen.getByText('a quoted line')).toBeDefined();
    expect(container.textContent).not.toContain('>');
  });

  test('renders bold inside a blockquote', () => {
    const { container } = render(<Markdown content="> **important** note" />);
    const bq = container.querySelector('blockquote');
    expect(bq).not.toBeNull();
    expect(bq?.querySelector('strong')?.textContent).toBe('important');
    expect(container.textContent).not.toContain('>');
    expect(container.textContent).not.toContain('*');
  });

  test('handles a quote with no space after the marker', () => {
    const { container } = render(<Markdown content=">quoted" />);
    expect(container.querySelector('blockquote')?.textContent).toBe('quoted');
  });

  test('still renders ordinary bold paragraphs', () => {
    const { container } = render(<Markdown content="this is **bold** text" />);
    expect(container.querySelector('blockquote')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });
});
