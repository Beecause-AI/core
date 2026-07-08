// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CloudflarePicker } from './cloudflare-picker';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const items = [
  { id: 'z1', name: 'checkout.com' },
  { id: 'z2', name: 'blog.example.com' },
];

describe('CloudflarePicker', () => {
  test('renders all items and clicking calls onToggle with its id', () => {
    const onToggle = vi.fn();
    render(<CloudflarePicker items={items} selected={[]} onToggle={onToggle} />);

    expect(screen.getByText('checkout.com')).toBeDefined();
    expect(screen.getByText('blog.example.com')).toBeDefined();

    fireEvent.click(screen.getByText('checkout.com'));
    expect(onToggle).toHaveBeenCalledWith('z1');

    fireEvent.click(screen.getByText('blog.example.com'));
    expect(onToggle).toHaveBeenCalledWith('z2');
  });

  test('typing in the search box filters visible items', () => {
    render(<CloudflarePicker items={items} selected={[]} onToggle={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'checkout' } });

    expect(screen.getByText('checkout.com')).toBeDefined();
    expect(screen.queryByText('blog.example.com')).toBeNull();
  });

  test('loading prop shows skeleton and hides item rows', () => {
    render(<CloudflarePicker items={items} selected={[]} onToggle={vi.fn()} loading />);

    // Skeleton renders with aria-busy; item names should not appear
    expect(screen.queryByText('checkout.com')).toBeNull();
    expect(screen.queryByText('blog.example.com')).toBeNull();
    // The skeleton container is present (aria-busy)
    expect(document.querySelector('[aria-busy]')).not.toBeNull();
  });

  test('selected item has aria-pressed="true"', () => {
    render(<CloudflarePicker items={items} selected={['z1']} onToggle={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    const z1Button = buttons.find((b) => b.textContent?.includes('checkout.com'));
    const z2Button = buttons.find((b) => b.textContent?.includes('blog.example.com'));

    expect(z1Button?.getAttribute('aria-pressed')).toBe('true');
    expect(z2Button?.getAttribute('aria-pressed')).toBe('false');
  });
});
