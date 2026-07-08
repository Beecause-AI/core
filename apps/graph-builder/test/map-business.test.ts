import { describe, it, expect, vi } from 'vitest';
import { mapBusiness } from '../src/map-business.js';

// Two multi-file communities — both are namable (>= 2 files each).
const clusters = [
  ['file:src/auth/login.ts', 'file:src/auth/token.ts'],
  ['file:src/pay/charge.ts', 'file:src/pay/refund.ts'],
];

const goodLlmResponse = JSON.stringify({
  flows: [
    { index: 0, name: 'Authentication', digest: 'Login and tokens.' },
    { index: 1, name: 'Payments', digest: 'Charges cards.' },
  ],
});

const makeEmbed = () =>
  async (texts: string[]) =>
    texts.map((_t, i) => {
      const v = new Array(768).fill(0);
      v[0] = i + 1;
      return v;
    });

describe('mapBusiness', () => {
  it('names clusters, attaches digests + embeddings, sums tokens', async () => {
    const llm = async () => ({ text: goodLlmResponse, inputTokens: 100, outputTokens: 40 });
    const out = await mapBusiness({ llm, embed: makeEmbed() }, { clusters });

    expect(out.tokens).toBe(140);
    expect(out.flows).toHaveLength(2);
    const [flow0] = out.flows;
    expect(flow0).toMatchObject({
      name: 'Authentication',
      digest: 'Login and tokens.',
      memberTmpIds: clusters[0],
    });
    expect(flow0!.embedding).toHaveLength(768);
    // v1 does not request per-file digests in the single call — always empty.
    expect(flow0!.fileDigests).toEqual({});
    expect(out.partial).toBe(false);
  });

  it('skips singleton clusters — only multi-file communities become flows', async () => {
    const withSingleton = [
      ['file:src/auth/login.ts', 'file:src/auth/token.ts'],
      ['file:src/standalone/util.ts'], // singleton → not a flow
    ];
    const llm = async () => ({
      text: JSON.stringify({ flows: [{ index: 0, name: 'Authentication', digest: 'Login and tokens.' }] }),
      inputTokens: 50,
      outputTokens: 20,
    });
    const out = await mapBusiness({ llm, embed: makeEmbed() }, { clusters: withSingleton });
    expect(out.partial).toBe(false);
    expect(out.flows).toHaveLength(1);
    expect(out.flows[0]!.name).toBe('Authentication');
    expect(out.flows[0]!.memberTmpIds).toEqual(withSingleton[0]);
  });

  it('returns empty flows with no llm/embed calls when no cluster has >= 2 files', async () => {
    const llm = vi.fn();
    const embed = vi.fn();
    const out = await mapBusiness(
      { llm: llm as never, embed: embed as never },
      { clusters: [['file:a.ts'], ['file:b.ts']] },
    );
    expect(out).toEqual({ flows: [], tokens: 0, partial: false });
    expect(llm).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('signals partial (no flows) when the LLM never returns valid JSON', async () => {
    const llm = async () => ({ text: 'not json', inputTokens: 5, outputTokens: 1 });
    const embed = async (texts: string[]) => texts.map(() => new Array(768).fill(0));
    const out = await mapBusiness({ llm, embed }, { clusters });
    expect(out.partial).toBe(true);
    expect(out.flows).toEqual([]);
    // tokens from both attempts should be summed
    expect(out.tokens).toBe(12);
  });

  it('returns empty flows with no llm/embed calls when clusters is empty', async () => {
    const llm = vi.fn();
    const embed = vi.fn();
    const out = await mapBusiness({ llm: llm as never, embed: embed as never }, { clusters: [] });
    expect(out).toEqual({ flows: [], tokens: 0, partial: false });
    expect(llm).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('retries on first junk response — succeeds on second, sums tokens from both attempts', async () => {
    let call = 0;
    const llm = async () => {
      call++;
      if (call === 1) return { text: '```garbage```', inputTokens: 10, outputTokens: 2 };
      return { text: goodLlmResponse, inputTokens: 100, outputTokens: 40 };
    };
    const out = await mapBusiness({ llm, embed: makeEmbed() }, { clusters });

    expect(out.partial).toBe(false);
    expect(out.flows).toHaveLength(2);
    expect(out.tokens).toBe(10 + 2 + 100 + 40);
    expect(out.flows[0]!.name).toBe('Authentication');
  });

  it('uses default name and empty fileDigests for a cluster index omitted by the LLM', async () => {
    const partialResponse = JSON.stringify({
      // Only provides index 1 — index 0 is omitted
      flows: [{ index: 1, name: 'Payments', digest: 'Charges cards.' }],
    });
    const llm = async () => ({ text: partialResponse, inputTokens: 50, outputTokens: 20 });
    const out = await mapBusiness({ llm, embed: makeEmbed() }, { clusters });

    expect(out.partial).toBe(false);
    expect(out.flows).toHaveLength(2);
    const [omitted, provided] = out.flows;
    expect(omitted!.name).toBe('Flow 1');
    expect(omitted!.digest).toBe('');
    expect(omitted!.fileDigests).toEqual({});
    expect(omitted!.memberTmpIds).toEqual(clusters[0]);
    expect(provided!.name).toBe('Payments');
  });

  it('tolerates JSON wrapped in markdown fences', async () => {
    const fenced = `\`\`\`json\n${goodLlmResponse}\n\`\`\``;
    const llm = async () => ({ text: fenced, inputTokens: 10, outputTokens: 5 });
    const out = await mapBusiness({ llm, embed: makeEmbed() }, { clusters });
    expect(out.partial).toBe(false);
    expect(out.flows[0]!.name).toBe('Authentication');
  });

  it('retries when llm throws on first attempt — succeeds on second, no partial', async () => {
    let call = 0;
    const llm = async () => {
      call++;
      if (call === 1) throw new Error('Vertex 503 transient');
      return { text: goodLlmResponse, inputTokens: 100, outputTokens: 40 };
    };
    const out = await mapBusiness({ llm, embed: makeEmbed() }, { clusters });

    expect(out.partial).toBe(false);
    expect(out.flows).toHaveLength(2);
    expect(out.tokens).toBe(140);
    expect(out.flows[0]!.name).toBe('Authentication');
  });

  it('returns partial:true with no flows when llm throws on both attempts, embed never called', async () => {
    const llm = async () => {
      throw new Error('Vertex 503 persistent');
    };
    let embedCalls = 0;
    const embed = async (texts: string[]) => {
      embedCalls++;
      return texts.map(() => new Array(768).fill(0));
    };
    const out = await mapBusiness({ llm, embed }, { clusters });

    expect(out.partial).toBe(true);
    expect(out.flows).toEqual([]);
    expect(out.tokens).toBe(0);
    expect(embedCalls).toBe(0);
  });
});
