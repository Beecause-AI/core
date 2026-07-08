/** A team-autogen job, published by the server and consumed by the graph-builder.
 *  Designs a team of assistants for the project from its knowledge graph. */
export type TeamAutogenJob = {
  orgId: string;
  projectId: string;
  /** The team_proposals row the worker writes the result into. */
  proposalId: string;
};

/** What the server uses to publish a team-autogen job (concrete impl wired at the server boot). */
export interface TeamAutogenPublisher {
  publish(job: TeamAutogenJob): Promise<void>;
}
