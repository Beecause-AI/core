import type { Db } from '../db/client.js';
import type { Assistant } from '../db/schema.js';
import type { TeamProposalDoc } from './proposal-schema.js';
import { createAssistant, updateAssistant, deleteAutogenAssistants } from '../repos/assistants.js';
import { breakDelegationCycles } from './acyclic.js';

/** Materialize a team version into the live assistants: delete all autogen-created agents
 *  (manual agents are kept), then create the proposal's agents stamped with `proposalId`.
 *  Delegation `agent.<key>` references are resolved to real `agent.<uuid>` once rows exist. */
export async function applyTeamProposal(
  db: Db, projectId: string, doc: TeamProposalDoc, proposalId: string,
): Promise<Assistant[]> {
  // Replace, don't append: wipe agents from any prior version first.
  await deleteAutogenAssistants(db, projectId);

  const keyToId = new Map<string, string>();
  const created: Assistant[] = [];

  // Pass 1: create each assistant WITHOUT agent.* tools (keys aren't ids yet).
  for (const a of doc.assistants) {
    // Keep non-agent tools AND system-agent tools (agent.sys.*).
    // Sibling delegation keys (agent.<key>) are stripped here and re-added as agent.<uuid> in Pass 2.
    const nonAgentTools = a.enabledTools.filter((t) => !t.startsWith('agent.') || t.startsWith('agent.sys.'));
    const row = await createAssistant(db, projectId, {
      name: a.name, persona: a.persona, model: a.model, provider: a.provider,
      enabledTools: nonAgentTools, isLead: a.isLead,
      sourceProposalId: proposalId, userModified: false,
    });
    keyToId.set(a.key, row.id);
    created.push(row);
  }

  // Pass 2: append resolved delegation edges. The proposal is already de-cycled by key
  // (normalizeProposal), but resolve to ids and run an id-graph cycle-break defensively so
  // the created team can never carry an agent.<id> loop. agent.sys.* tools are untouched.
  const idGraph = doc.assistants.map((a, i) => ({
    key: created[i]!.id,
    delegatesTo: a.delegatesTo.map((k) => keyToId.get(k)).filter((id): id is string => !!id),
  }));
  const acyclic = breakDelegationCycles(idGraph);
  const edgesById = new Map(acyclic.map((n) => [n.key, n.delegatesTo]));

  for (let i = 0; i < doc.assistants.length; i++) {
    const row = created[i]!;
    const agentTools = (edgesById.get(row.id) ?? []).map((id) => `agent.${id}`);
    if (agentTools.length === 0) continue;
    const updated = await updateAssistant(db, projectId, row.id, { enabledTools: [...row.enabledTools, ...agentTools] });
    if (updated) created[i] = updated;
  }

  return created;
}
