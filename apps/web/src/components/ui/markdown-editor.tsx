'use client';

import dynamic from 'next/dynamic';
import { cn } from './cn';

// Client-only: the editor touches browser APIs and must not execute during the Next
// static-export prerender, so it's loaded with ssr:false.
const CodeEditor = dynamic(() => import('@uiw/react-textarea-code-editor'), { ssr: false });

/**
 * Raw-Markdown source editor with Prism syntax highlighting — you see the literal
 * markdown, styled (headings, emphasis, code, links). It auto-grows with its content
 * (no internal scrollbar), so a long persona pushes the page down instead of trapping
 * the scroll inside a fixed box.
 */
export function MarkdownEditor({ value, onChange, placeholder, className }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      data-color-mode="dark"
      className={cn(
        'overflow-hidden rounded-md border border-edge-strong bg-raised focus-within:border-accent',
        className,
      )}
    >
      <CodeEditor
        value={value}
        language="markdown"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        padding={12}
        // The editor root needs an inline style hook; keep it to a transparent bg (the
        // wrapper owns the surface token) and a comfortable empty-state height.
        style={{ backgroundColor: 'transparent', fontSize: 13, minHeight: '10rem' }}
      />
    </div>
  );
}
