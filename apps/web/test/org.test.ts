import { describe, expect, test } from 'vitest';
import { currentSlug } from '../src/lib/org';

describe('currentSlug', () => {
  test('extracts the slug from a prod org host', () => {
    expect(currentSlug('acme.beecause.ai')).toBe('acme');
  });

  test('apex prod host is org-agnostic', () => {
    expect(currentSlug('beecause.ai')).toBe(null);
  });

  test('reserved prod subdomains are org-agnostic', () => {
    expect(currentSlug('www.beecause.ai')).toBe(null);
  });

  // Dev parity: the server already resolves {slug}.localhost org hosts
  // (slugFromHost off BASE_URL) — the client must agree, or dev org hosts
  // render the org picker instead of the workspace.
  test('extracts the slug from a dev org host', () => {
    expect(currentSlug('e2e-foo.localhost')).toBe('e2e-foo');
  });

  test('bare localhost is org-agnostic', () => {
    expect(currentSlug('localhost')).toBe(null);
  });

  test('reserved dev subdomains are org-agnostic', () => {
    expect(currentSlug('www.localhost')).toBe(null);
  });

  test('nested labels are not org hosts', () => {
    expect(currentSlug('a.b.localhost')).toBe(null);
  });

  test('foreign hosts are org-agnostic', () => {
    expect(currentSlug('example.com')).toBe(null);
  });
});
