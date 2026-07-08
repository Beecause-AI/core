// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { IntegrationHero } from './integration-hero';
import { INTEGRATION_CONTENT } from '../../lib/integration-content';
import { INTEGRATIONS } from '../../lib/integrations';

afterEach(() => cleanup());

describe('IntegrationHero', () => {
  test('renders the heading, value prop, bullets and children', () => {
    render(<IntegrationHero provider="gcp"><button>Add connection</button></IntegrationHero>);
    expect(screen.getByText('Connect Google Cloud')).toBeTruthy();
    expect(screen.getByText(INTEGRATION_CONTENT.gcp.valueProp)).toBeTruthy();
    for (const b of INTEGRATION_CONTENT.gcp.bullets) expect(screen.getByText(b)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add connection' })).toBeTruthy();
  });
});

describe('INTEGRATION_CONTENT registry', () => {
  test('has a value prop + exactly 3 bullets for every integration', () => {
    for (const i of INTEGRATIONS) {
      const c = INTEGRATION_CONTENT[i.id];
      expect(c, `missing content for ${i.id}`).toBeTruthy();
      expect(c.valueProp.length).toBeGreaterThan(0);
      expect(c.bullets).toHaveLength(3);
    }
  });
});
