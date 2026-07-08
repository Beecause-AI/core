import type { BuiltinTool } from '../types.js';

/** Deterministic, read-only example tool: adds two numbers. */
export const addTool: BuiltinTool = {
  def: {
    name: 'builtin.add',
    description: 'Add two numbers and return the sum.',
    kind: 'builtin',
    mutates: false,
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'first addend' },
        b: { type: 'number', description: 'second addend' },
      },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  },
  async run(args) {
    const { a, b } = (args ?? {}) as { a?: unknown; b?: unknown };
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new Error('add requires numeric "a" and "b"');
    }
    return String(a + b);
  },
};
