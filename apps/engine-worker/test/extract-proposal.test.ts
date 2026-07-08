import { describe, it, expect } from 'vitest';
import { extractProposalFromText } from '../src/engine/extract-proposal.js';

describe('extractProposalFromText', () => {
  it('parses a fenced ```json block', () => {
    const text = 'Here is the team:\n```json\n{"rationale":"r","assistants":[],"gaps":[]}\n```\nDone.';
    expect(extractProposalFromText(text)).toEqual({ rationale: 'r', assistants: [], gaps: [] });
  });

  it('parses a bare JSON object when there is no fence', () => {
    expect(extractProposalFromText('prefix {"assistants":[{"key":"a"}]} suffix')).toEqual({ assistants: [{ key: 'a' }] });
  });

  it('returns null when no JSON is present', () => {
    expect(extractProposalFromText('no json here')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(extractProposalFromText('```json\n{not valid}\n```')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractProposalFromText('')).toBeNull();
  });
});
