import type { Db, Store } from '@intellilabs/core';
import { makeLogger } from '@intellilabs/core';
import type { KgSkill, Phase } from '@intellilabs/kg-skills';
import type { RepoClient } from './repo-reader.js';
import type { BuildJob } from './app.js';
import { runStructure } from './phases/structure.js';
import { runArchitecture } from './phases/architecture.js';
import { runFlows } from './phases/flows.js';
import { runDependencies } from './phases/dependencies.js';
import { runFinalize } from './phases/finalize.js';

/** Re-enqueue payload for the next phase. A no-op publisher is used locally/in tests. */
export interface KgPublisher {
  publish(job: BuildJob): Promise<void>;
}

/** Record shape for a single model invocation (LLM or embedding). */
export interface InvocationRecord {
  source: string;
  orgId?: string | null;
  model: string;
  provider?: string | null;
  buildId?: string | null;
  operationId?: string | null;
  phase?: string | null;
  messages: unknown;
  output: string;
  inputTokens: number;
  outputTokens: number;
  status: 'ok' | 'error';
  error?: string | null;
}

export interface RunPhaseDeps {
  db: Db;
  /** Full store (Firestore + vector index); finalize needs the vector index for embeddings. */
  store: Store;
  client: RepoClient;
  config: { SECRETS_KEY?: string; GITHUB_APP_ID?: string; GITHUB_APP_PRIVATE_KEY?: string };
  semantic?: {
    llm: (orgId: string, prompt: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
    embed: (orgId: string, texts: string[]) => Promise<number[][]>;
  };
  /** Best-effort telemetry sink. Omit in tests/local to no-op. */
  recordInvocation?: (rec: InvocationRecord) => Promise<void> | void;
  kgPublisher: KgPublisher;
  skills: {
    skillsFor: (phase: Phase) => KgSkill[];
    listSkills: () => KgSkill[];
  };
}

const log = makeLogger({ service: 'graph-builder', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

/** Per-phase dispatcher: routes a build job to its phase module. */
export async function runPhase(deps: RunPhaseDeps, job: BuildJob): Promise<void> {
  const phase: Phase = job.phase ?? 'structure';
  switch (phase) {
    case 'structure':
      await runStructure(deps, job);
      return;
    case 'architecture':
      await runArchitecture(deps, job);
      return;
    case 'flows':
      await runFlows(deps, job);
      return;
    case 'dependencies':
      await runDependencies(deps, job);
      return;
    case 'finalize':
      await runFinalize(deps, job);
      return;
    default:
      log.warn({ phase }, `graph-builder: unknown phase '${phase as string}'; skipping`);
      return;
  }
}
