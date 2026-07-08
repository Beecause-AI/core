import type { SignalSkill, SignalFinding, RepoSnapshot } from './types.js';

function uniq(xs: string[]): string[] { return [...new Set(xs)]; }

/** Pure deterministic detection: a skill matches if ANY of its markers hits. Evidence is recorded. */
export function detectSignalsFromSnapshot(skills: SignalSkill[], snap: RepoSnapshot): SignalFinding[] {
  const out: SignalFinding[] = [];
  for (const skill of skills) {
    const ev: string[] = [];
    const m = skill.markers;
    for (const d of m.deps ?? []) if (snap.deps.has(d)) ev.push(`dependency: ${d}`);
    for (const p of m.depPrefixes ?? []) for (const d of snap.deps) if (d.startsWith(p)) ev.push(`dependency: ${d}`);
    for (const rx of m.filePatterns ?? []) { const re = new RegExp(rx); for (const f of snap.filePaths) if (re.test(f)) ev.push(`file: ${f}`); }
    for (const rx of m.contentPatterns ?? []) { const re = new RegExp(rx); for (const sc of snap.scannedContent) if (re.test(sc.content)) ev.push(`pattern /${rx}/ in ${sc.path}`); }
    if (ev.length > 0) out.push({ skillId: skill.id, product: skill.product, integration: skill.integration, evidence: uniq(ev).slice(0, 8), signals: skill.signals });
  }
  return out;
}
