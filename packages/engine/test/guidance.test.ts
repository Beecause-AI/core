import { describe, it, expect } from 'vitest';
import {
  toolGuidanceBlocks,
  RECENT_SEARCH_GUIDANCE,
  MEMORY_RECALL_GUIDANCE,
} from '../src/tools/guidance.js';

describe('toolGuidanceBlocks', () => {
  it('returns the memory.recall block whenever the tool is held (cadence always)', () => {
    expect(toolGuidanceBlocks(['memory.recall'], { incidentStart: false })).toEqual([MEMORY_RECALL_GUIDANCE]);
    expect(toolGuidanceBlocks(['memory.recall'], { incidentStart: true })).toEqual([MEMORY_RECALL_GUIDANCE]);
  });

  it('returns recent.search only at incident start (cadence incidentStart)', () => {
    expect(toolGuidanceBlocks(['recent.search'], { incidentStart: true })).toEqual([RECENT_SEARCH_GUIDANCE]);
    expect(toolGuidanceBlocks(['recent.search'], { incidentStart: false })).toEqual([]);
  });

  it('ignores tools not in the registry and returns [] when nothing matches', () => {
    expect(toolGuidanceBlocks(['integration.github.get_file', 'skill.load'], { incidentStart: true })).toEqual([]);
    expect(toolGuidanceBlocks([], { incidentStart: true })).toEqual([]);
  });

  it('combines held flat tools (registry order)', () => {
    expect(toolGuidanceBlocks(['memory.recall', 'recent.search'], { incidentStart: true }))
      .toEqual([RECENT_SEARCH_GUIDANCE, MEMORY_RECALL_GUIDANCE]);
  });
});
