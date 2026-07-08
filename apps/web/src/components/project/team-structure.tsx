'use client';

import type { Assistant, SystemAgentMeta } from '../../lib/api';
import { Badge } from '../ui/badge';

type SystemAgentMap = Record<string, string>; // key → display name

/** A node in the structure tree: either a DB assistant or a predefined system agent. */
type Node =
  | { kind: 'assistant'; assistant: Assistant }
  | { kind: 'system'; key: string; name: string };

/** The system-agent keys an assistant delegates to (via `agent.sys.<key>` in enabledTools). */
function systemDelegateKeys(a: Assistant): string[] {
  return a.enabledTools
    .filter((t) => t.startsWith('agent.sys.'))
    .map((t) => t.slice('agent.sys.'.length));
}

/**
 * Read-only indented tree.
 *
 * Entry topology: when Slack is connected AND the project has an orchestrator (the single
 * `is_lead` assistant), the Slack Intake system agent is the front door — it parents the
 * orchestrator. Otherwise the orchestrator(s)/roots are the entry points directly.
 *
 * System agents an assistant delegates to (`agent.sys.<key>`, e.g. Hindsight) render as
 * leaf "system" nodes under that assistant.
 */
export function TeamStructure({
  slug, assistants, systemAgents = {}, slackConnected = false,
}: {
  slug: string;
  assistants: Assistant[];
  systemAgents?: SystemAgentMap;
  slackConnected?: boolean;
}) {
  if (assistants.length === 0) return null;
  const byId = new Map(assistants.map((a) => [a.id, a]));

  const delegatesOf = (a: Assistant): Node[] => {
    const assistantChildren: Node[] = a.enabledTools
      .filter((t) => t.startsWith('agent.') && !t.startsWith('agent.sys.'))
      .map((t) => byId.get(t.slice('agent.'.length)))
      .filter((x): x is Assistant => !!x)
      .map((x) => ({ kind: 'assistant', assistant: x }));
    const systemChildren: Node[] = systemDelegateKeys(a).map((key) => ({
      kind: 'system', key, name: systemAgents[key] ?? key,
    }));
    return [...assistantChildren, ...systemChildren];
  };

  const delegatedTo = new Set(
    assistants.flatMap((a) =>
      a.enabledTools
        .filter((t) => t.startsWith('agent.') && !t.startsWith('agent.sys.'))
        .map((t) => t.slice('agent.'.length)),
    ),
  );
  // Roots are entry points — assistants nobody delegates to. A lead that is itself
  // delegated to is NOT a root; it renders nested under whoever delegates to it.
  // Fallbacks keep the tree non-empty if every node is delegated to (a delegation cycle).
  let roots = assistants.filter((a) => !delegatedTo.has(a.id));
  if (roots.length === 0) roots = assistants.filter((a) => a.isLead);
  if (roots.length === 0) roots = assistants;
  // Leads first among the roots.
  roots = [...roots].sort((a, b) => Number(b.isLead) - Number(a.isLead));

  const orchestrator = assistants.find((a) => a.isLead) ?? null;
  const slackAgent = systemAgents['slack'];

  // Entry topology: when Slack is connected and an orchestrator exists, the Slack Intake
  // system agent is the single front door that delegates to the orchestrator.
  const rootNodes: Node[] = (slackConnected && orchestrator && slackAgent)
    ? [{ kind: 'system', key: 'slack', name: slackAgent }]
    : roots.map((a) => ({ kind: 'assistant', assistant: a }));

  // A SINGLE shared set for the whole render: every assistant AND every system node renders
  // at most ONCE (the first time DFS reaches it from the roots). This makes the output a real
  // TREE even when the underlying delegation graph is dense or cyclic — sub-delegations to
  // already-rendered nodes are pruned instead of exploding the node count.
  const rendered = new Set<string>();

  const SystemRow = ({ node, depth, children }: { node: { key: string; name: string }; depth: number; children?: Node[] }) => {
    if (rendered.has(`sys.${node.key}`)) return null;
    rendered.add(`sys.${node.key}`);
    return (
      <div>
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5" style={{ marginLeft: depth * 16 }}>
          <span className="text-sm font-medium text-fg">{node.name}</span>
          <Badge status="neutral">system</Badge>
        </div>
        {children?.map((c) => <NodeRow key={nodeKey(c)} node={c} depth={depth + 1} />)}
      </div>
    );
  };

  const AssistantRow = ({ a, depth }: { a: Assistant; depth: number }) => {
    if (rendered.has(a.id)) return null;
    rendered.add(a.id);
    return (
      <div>
        <a
          href={`/p/${slug}/assistants/${a.id}`}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 no-underline hover:bg-raised"
          style={{ marginLeft: depth * 16 }}
        >
          <span className="text-sm font-medium text-fg">{a.name}</span>
          {a.isLead && <Badge status="info">orchestrator</Badge>}
          {a.sourceProposalId ? <Badge status="neutral">AI</Badge> : <Badge status="neutral">manual</Badge>}
          {a.userModified && <Badge status="warn">edited</Badge>}
          <span className="ml-auto hidden font-mono text-xs text-fg-faint sm:inline">{a.model}</span>
        </a>
        {delegatesOf(a).map((c) => (
          <NodeRow key={nodeKey(c)} node={c} depth={depth + 1} />
        ))}
      </div>
    );
  };

  const NodeRow = ({ node, depth }: { node: Node; depth: number }) =>
    node.kind === 'assistant'
      ? <AssistantRow a={node.assistant} depth={depth} />
      : <SystemRow node={node} depth={depth} />;

  return (
    <div className="rounded-card border border-edge bg-surface p-2">
      {!slackConnected && slackAgent && (
        // Slack not integrated for this project — show a greyed placeholder front door so the
        // missing intake is visible, with a link to connect. Decorative only: it is NOT part of
        // rootNodes, so the live tree / `rendered` set is unaffected.
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 opacity-60">
          <span className="text-sm font-medium text-fg">{slackAgent}</span>
          <Badge status="neutral">not connected</Badge>
          <a className="text-xs text-accent underline" href={`/p/${slug}/integrations/slack`}>Connect Slack →</a>
        </div>
      )}
      {rootNodes.map((node) => {
        if (node.kind === 'system' && node.key === 'slack' && orchestrator) {
          // Slack front door → orchestrator (rendered first so the orchestrator's own
          // first-level delegations are what show; later sub-edges to it are pruned).
          return (
            <SystemRow
              key="sys.slack"
              node={node}
              depth={0}
              children={[{ kind: 'assistant', assistant: orchestrator }]}
            />
          );
        }
        return <NodeRow key={nodeKey(node)} node={node} depth={0} />;
      })}
    </div>
  );
}

function nodeKey(n: Node): string {
  return n.kind === 'assistant' ? n.assistant.id : `sys.${n.key}`;
}

/** Convert the system-agent list into the key→name map the tree consumes. */
export function systemAgentsMap(list: SystemAgentMeta[]): SystemAgentMap {
  return Object.fromEntries(list.map((s) => [s.key, s.name]));
}
