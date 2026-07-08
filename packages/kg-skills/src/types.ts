export type SkillKind = 'detector' | 'extractor' | 'mapper';
export type Phase = 'structure' | 'architecture' | 'flows' | 'dependencies' | 'finalize';

/** A node/edge contribution, keyed by NAME (the builder resolves names→db ids within a build). */
export interface SkillNode { kind: string; name: string; digest?: string | null; metadata?: Record<string, unknown> | null; repoFullName?: string | null }
export interface SkillEdge { srcName: string; dstName: string; relation: string }
export interface SkillContribution { nodes: SkillNode[]; edges: SkillEdge[] }
export interface SkillCandidate extends SkillNode {}

/** Input to a deterministic detector: files already read for one repo + parsed manifests. */
export interface DetectInput {
  repoFullName: string;
  files: { path: string; content?: string }[];
  manifests?: { packageJson?: unknown; dockerCompose?: unknown; [k: string]: unknown };
}
/** Context for an agentic skill's prompt fragment (curated, serializable). */
export interface SkillPromptCtx { repoFullName?: string; area?: string; summary?: string; [k: string]: unknown }
export interface SkillParseCtx { repoFullName?: string; area?: string; [k: string]: unknown }

export interface KgSkill {
  id: string;
  title: string;
  description: string;
  kind: SkillKind;
  phase: Phase;
  integration?: string;          // 'otel'|'grafana'|'datadog'|'sentry'|'cloud-ops'|'postgres'|'stripe'|...
  /** For the super-console preview (static, no runtime ctx needed). */
  preview?: string;
  detect?(input: DetectInput): SkillCandidate[];
  promptFragment?(ctx: SkillPromptCtx): string;
  parse?(modelJson: unknown, ctx: SkillParseCtx): SkillContribution;
}
