import {
  createAgentRun,
  getOrgApprovalPolicy,
  getProjectApprovalPolicy,
  getIntegration,
  decryptSecret,
  type Db,
  type QueuedTurn,
  type SlackClient,
} from '@intellilabs/core';
import { resolveApprovalRequired, type ApprovalContext } from '@intellilabs/engine';

type SuspendPayload = {
  model?: string;
  projectId?: string;
  enabledTools?: string[];
  decision?: 'approved' | 'denied';
  slack?: { channel: string; threadTs: string; placeholderTs: string };
};

/** EngineDeps.approval factory: resolves org-over-project policy + carries the resume decision. */
export function makeApproval(db: Db) {
  return async (turn: QueuedTurn): Promise<ApprovalContext> => {
    const p = turn.payload as SuspendPayload;
    const orgPolicy = await getOrgApprovalPolicy(db, turn.orgId);
    const projectPolicy = p.projectId ? await getProjectApprovalPolicy(db, p.projectId) : null;
    return { required: resolveApprovalRequired(orgPolicy, projectPolicy), decision: p.decision };
  };
}

export type SuspendDeps = { db: Db; secretsKey: () => Buffer; client: SlackClient };

/** EngineDeps.onSuspend: persist the agent_run bridge + post a Slack Approve/Deny message. */
export function makeOnSuspend(deps: SuspendDeps) {
  return async (
    turn: QueuedTurn,
    data: { messages: unknown; calls: Array<{ id: string; name: string }> },
  ): Promise<void> => {
    const p = turn.payload as SuspendPayload;
    const run = await createAgentRun(deps.db, {
      turnId: turn.id,
      laneId: turn.laneId,
      orgId: turn.orgId,
      messages: data.messages,
      pendingCalls: data.calls,
      model: p.model ?? '',
      enabledTools: p.enabledTools ?? [],
      slack: p.slack ?? null,
    });
    const slack = p.slack;
    if (!slack) return;
    const conn = await getIntegration(deps.db, turn.orgId, 'slack');
    if (!conn?.secretCiphertext) return;
    const token = decryptSecret(conn.secretCiphertext, deps.secretsKey());
    const names = data.calls.map((c) => c.name).join(', ');
    await deps.client.chatUpdate(token, {
      channel: slack.channel,
      ts: slack.placeholderTs,
      text: `Approval needed to run ${names}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:lock: I need approval to run *${names}*.` },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve', emoji: true },
              style: 'primary',
              action_id: 'agent_approve',
              value: `${run.id}:approve`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Deny', emoji: true },
              style: 'danger',
              action_id: 'agent_deny',
              value: `${run.id}:deny`,
            },
          ],
        },
      ],
    });
  };
}
