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
  id: 'extract-architecture',
  title: 'Extract Architecture Components',
  description: 'Identifies high-level architectural components and the files composing each.',
  kind: 'extractor',
  phase: 'architecture',
  preview: 'Prompts the model to enumerate architectural components and map each to its constituent files, returning structured JSON.',

  promptFragment(ctx: SkillPromptCtx): string {
    const areaPart = ctx.area ? `\nFocus on the area: ${ctx.area}.` : '';
    return (
      `You are a software architect. Given the project structural summary below, identify the high-level architectural components and the files that compose each one.${areaPart}\n\n` +
      `PROJECT SUMMARY:\n${ctx.summary ?? ''}\n\n` +
      `Return ONLY valid JSON in this exact shape (no explanation, no markdown):\n` +
      `{"components":[{"index":0,"name":"ComponentName","digest":"One-sentence description.","files":["path/to/file.ts"]}]}`
    );
  },

  parse(modelJson: unknown, ctx: SkillParseCtx): SkillContribution {
    const parsed = extractJson(modelJson);
    if (!parsed || typeof parsed !== 'object') return { nodes: [], edges: [] };

    const data = parsed as Record<string, unknown>;
    const components = Array.isArray(data['components']) ? data['components'] : [];

    const nodes: SkillContribution['nodes'] = [];
    const edges: SkillContribution['edges'] = [];

    for (const comp of components) {
      if (!comp || typeof comp !== 'object') continue;
      const c = comp as Record<string, unknown>;
      const name = typeof c['name'] === 'string' ? c['name'] : null;
      const digest = typeof c['digest'] === 'string' ? c['digest'] : null;
      if (!name) continue;

      nodes.push({ kind: 'component', name, digest, repoFullName: ctx.repoFullName ?? null });

      const files = Array.isArray(c['files']) ? c['files'] : [];
      for (const f of files) {
        if (typeof f === 'string' && f) {
          edges.push({ srcName: name, dstName: f, relation: 'composes' });
        }
      }
    }

    return { nodes, edges };
  },
});
