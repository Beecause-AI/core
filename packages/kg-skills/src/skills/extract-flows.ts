import { register } from '../registry.js';
import type { SkillPromptCtx, SkillParseCtx, SkillContribution } from '../types.js';

function extractJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch { /* ignore */ }
  }
  return null;
}

register({
  id: 'extract-flows',
  title: 'Extract Business Flows',
  description: 'Identifies end-to-end business flows, the components they touch, and the files that implement them.',
  kind: 'extractor',
  phase: 'flows',
  preview: 'Prompts the model to enumerate business flows with the architectural components and files each flow spans, returning structured JSON.',

  promptFragment(ctx: SkillPromptCtx): string {
    const areaPart = ctx.area ? `\nFocus on the area: ${ctx.area}.` : '';
    return (
      `You are a software architect. Given the project components and their files below, identify the end-to-end business flows.${areaPart}\n\n` +
      `PROJECT SUMMARY:\n${ctx.summary ?? ''}\n\n` +
      `Return ONLY valid JSON in this exact shape (no explanation, no markdown):\n` +
      `{"flows":[{"name":"FlowName","digest":"One-sentence description.","components":["ComponentName"],"files":["path/to/file.ts"]}]}`
    );
  },

  parse(modelJson: unknown, ctx: SkillParseCtx): SkillContribution {
    const parsed = extractJson(modelJson);
    if (!parsed || typeof parsed !== 'object') return { nodes: [], edges: [] };

    const data = parsed as Record<string, unknown>;
    const flows = Array.isArray(data['flows']) ? data['flows'] : [];

    const nodes: SkillContribution['nodes'] = [];
    const edges: SkillContribution['edges'] = [];

    for (const flow of flows) {
      if (!flow || typeof flow !== 'object') continue;
      const f = flow as Record<string, unknown>;
      const name = typeof f['name'] === 'string' ? f['name'] : null;
      const digest = typeof f['digest'] === 'string' ? f['digest'] : null;
      if (!name) continue;

      nodes.push({ kind: 'flow', name, digest, repoFullName: ctx.repoFullName ?? null });

      const components = Array.isArray(f['components']) ? f['components'] : [];
      for (const comp of components) {
        if (typeof comp === 'string' && comp) {
          edges.push({ srcName: name, dstName: comp, relation: 'touches' });
        }
      }

      const files = Array.isArray(f['files']) ? f['files'] : [];
      for (const file of files) {
        if (typeof file === 'string' && file) {
          edges.push({ srcName: name, dstName: file, relation: 'implements_flow' });
        }
      }
    }

    return { nodes, edges };
  },
});
