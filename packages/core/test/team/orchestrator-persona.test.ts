import { expect, it } from 'vitest';
import { getAnalysisAgent } from '../../src/team/analysis-fleet/registry.js';

it('orchestrator persona no longer bakes the recent.search instruction (now deterministic)', () => {
  const orch = getAnalysisAgent('analysis.orchestrator')!;
  // recent.search guidance is injected deterministically via the engine tool-guidance registry +
  // subagent.ts; the generation persona must not duplicate/own it.
  expect(orch.persona).not.toContain('recent.search');
});
