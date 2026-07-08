import { describe, expect, it } from 'vitest';
import { renderCopilotOfferMessage, COPILOT_ACTION_IDS } from '../../src/integrations/copilot-offer.js';

const withRepo = { id: 'off-1', summary: 'Fix the widget', repo: 'acme/api', candidateRepos: [] as string[] };
const noRepo = { id: 'off-2', summary: 'Fix the widget', repo: null as string | null, candidateRepos: ['acme/api', 'acme/web'] };

function createButton(blocks: unknown[]) {
  return (blocks as any[]).flatMap((b) => b.elements ?? []).find((e: any) => e.action_id === COPILOT_ACTION_IDS.create);
}

describe('renderCopilotOfferMessage', () => {
  it('uses plain GitHub issue copy', () => {
    const { blocks } = renderCopilotOfferMessage(withRepo);
    expect(createButton(blocks).text.text).toBe('Create GitHub issue');
  });

  it('renders a repo select (with candidates) when no repo is chosen', () => {
    const { blocks } = renderCopilotOfferMessage(noRepo);
    const select = (blocks as any[]).flatMap((b) => b.elements ?? []).find((e: any) => e.type === 'static_select');
    expect(select.action_id).toBe(COPILOT_ACTION_IDS.repoSelect);
    expect(select.options.length).toBe(2);
  });
});
