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
  id: 'link-dependencies',
  title: 'Link Dependencies',
  description: 'Maps components and flows to their datastore/external dependencies and emitted signals (metrics, logs, traces).',
  kind: 'mapper',
  phase: 'dependencies',
  preview: 'Prompts the model to enumerate datastore/external dependencies and emitted signals for each component or flow, returning structured JSON.',

  promptFragment(ctx: SkillPromptCtx): string {
    const areaPart = ctx.area ? `\nFocus on the area: ${ctx.area}.` : '';
    const providers = Array.isArray(ctx.detectedProviders)
      ? (ctx.detectedProviders as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];
    const allowlist = providers.length ? providers.join(', ') : '(none detected)';
    const groundingPart =
      `\n\nGROUNDING RULES:\n` +
      `- Only attribute telemetry (metrics/logs/traces) to these CONFIRMED observability providers: ${allowlist}. ` +
      `Do NOT invent metrics/logs/traces for any other provider (e.g. do not assume Prometheus/Datadog/Elasticsearch/Jaeger unless they appear in that list). ` +
      `If none are confirmed, do not emit any telemetry signals.\n` +
      `- Only reference datastores/external services that are either listed in the candidates above or that you can justify directly from the code; prefer the listed ones.`;
    return (
      `You are a software architect. Given the project components, flows, and detected datastore/external/signal candidates below, map each component or flow to its dependencies and emitted signals.${areaPart}\n\n` +
      `PROJECT SUMMARY:\n${ctx.summary ?? ''}` +
      groundingPart +
      `\n\nReturn ONLY valid JSON in this exact shape (no explanation, no markdown):\n` +
      `{"links":[{"owner":"compOrFlowName","dependsOn":[{"kind":"datastore|external","name":"resourceName"}],"emits":[{"kind":"metric|log|trace","name":"signalName","provider":"providerName"}]}]}`
    );
  },

  parse(modelJson: unknown, _ctx: SkillParseCtx): SkillContribution {
    const parsed = extractJson(modelJson);
    if (!parsed || typeof parsed !== 'object') return { nodes: [], edges: [] };

    const data = parsed as Record<string, unknown>;
    const links = Array.isArray(data['links']) ? data['links'] : [];

    const nodes: SkillContribution['nodes'] = [];
    const edges: SkillContribution['edges'] = [];

    // Track emitted node names to avoid duplicates within this parse call
    const seen = new Set<string>();

    for (const link of links) {
      if (!link || typeof link !== 'object') continue;
      const l = link as Record<string, unknown>;
      const owner = typeof l['owner'] === 'string' ? l['owner'] : null;
      if (!owner) continue;

      const dependsOn = Array.isArray(l['dependsOn']) ? l['dependsOn'] : [];
      for (const dep of dependsOn) {
        if (!dep || typeof dep !== 'object') continue;
        const d = dep as Record<string, unknown>;
        const kind = typeof d['kind'] === 'string' ? d['kind'] : 'external';
        const name = typeof d['name'] === 'string' ? d['name'] : null;
        if (!name) continue;

        edges.push({ srcName: owner, dstName: name, relation: 'depends_on' });

        const nodeKey = `${kind}:${name}`;
        if (!seen.has(nodeKey)) {
          seen.add(nodeKey);
          nodes.push({ kind, name });
        }
      }

      const emits = Array.isArray(l['emits']) ? l['emits'] : [];
      for (const sig of emits) {
        if (!sig || typeof sig !== 'object') continue;
        const s = sig as Record<string, unknown>;
        const kind = typeof s['kind'] === 'string' ? s['kind'] : 'metric';
        const name = typeof s['name'] === 'string' ? s['name'] : null;
        const provider = typeof s['provider'] === 'string' ? s['provider'] : undefined;
        if (!name) continue;

        edges.push({ srcName: owner, dstName: name, relation: 'emits' });

        const nodeKey = `${kind}:${name}`;
        if (!seen.has(nodeKey)) {
          seen.add(nodeKey);
          nodes.push({
            kind,
            name,
            ...(provider !== undefined ? { metadata: { provider } } : {}),
          });
        }
      }
    }

    return { nodes, edges };
  },
});
