'use client';

import { useState } from 'react';
import type { JSX } from 'react';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../ui/cn';

export type PickerItem = { id: string; name: string };

export function CloudflarePicker({
  items,
  selected,
  onToggle,
  loading = false,
  placeholder = 'Search…',
  emptyText = 'No matches',
}: {
  items: PickerItem[];
  selected: string[];
  onToggle: (id: string) => void;
  loading?: boolean;
  placeholder?: string;
  emptyText?: string;
}): JSX.Element {
  const [query, setQuery] = useState('');

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Input value="" onChange={() => {}} placeholder={placeholder} disabled aria-label="Search" />
        <Skeleton rows={3} />
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
    : items;

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label="Search"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-fg-faint">{emptyText}</p>
      ) : (
        <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
          {filtered.map((item) => {
            const isSelected = selected.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onToggle(item.id)}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-raised',
                  isSelected && 'bg-raised',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium text-fg">{item.name}</span>
                  {item.id !== item.name && (
                    <span className="truncate font-mono text-xs text-fg-faint">{item.id}</span>
                  )}
                </span>
                {isSelected && (
                  <span className="ml-3 shrink-0 text-accent" aria-hidden>✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
