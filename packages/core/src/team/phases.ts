/**
 * Ordered, user-facing phases of the team-autogen pipeline. The graph-builder writes the
 * current phase to `team_proposals.progress` as it advances; the web polls and renders a
 * checklist + progress bar. Order is monotonic — the pipeline never moves a phase backwards
 * (the revise loop stays in `reviewing`) so the bar only ever fills.
 */
export const TEAM_AUTOGEN_PHASES = [
  'analyzing',   // reading repos + detecting signals + cartographer/detector
  'mapping',     // tag gaps + assemble facts
  'designing',   // compose the team
  'reviewing',   // adversarial review + bounded revise loop
  'finalizing',  // persist the proposal
] as const;

export type TeamAutogenPhase = (typeof TEAM_AUTOGEN_PHASES)[number];
