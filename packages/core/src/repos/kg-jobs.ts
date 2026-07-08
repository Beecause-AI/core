/** A graph-build job, published by the server and consumed by the graph-builder. */
export type KgBuildJob = {
  orgId: string;
  projectId?: string;
  repoFullName: string;
  ref?: string;
  mode: 'initial' | 'manual' | 'incremental';
  /** Set on project-level builds so the worker can attach to the pre-created build row. */
  buildId?: string;
  /** Pipeline phase hint for the worker (e.g. 'structure', 'flows', 'finalize'). */
  phase?: string;
};

/** What the server uses to publish a build job (concrete impl wired at the server boot). */
export interface KgJobPublisher {
  publish(job: KgBuildJob): Promise<void>;
}
