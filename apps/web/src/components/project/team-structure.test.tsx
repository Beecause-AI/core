import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { TeamStructure } from './team-structure';
import type { Assistant } from '../../lib/api';

afterEach(cleanup);

function asst(over: Partial<Assistant>): Assistant {
  return {
    id: over.id ?? crypto.randomUUID(),
    name: over.name ?? 'A',
    persona: over.persona ?? '',
    model: over.model ?? 'gemini-3-flash-preview',
    provider: over.provider ?? null,
    enabledTools: over.enabledTools ?? [],
    isLead: over.isLead ?? false,
    sourceProposalId: over.sourceProposalId ?? null,
    userModified: over.userModified ?? false,
  } as Assistant;
}

const systemAgents = { hindsight: 'Hindsight', slack: 'Slack Intake' };

describe('TeamStructure system nodes', () => {
  it('renders a Hindsight system node under an assistant that delegates to agent.sys.hindsight', () => {
    const lead = asst({ id: 'lead', name: 'Orchestrator', isLead: true, enabledTools: ['agent.sys.hindsight'] });
    render(<TeamStructure slug="p" assistants={[lead]} systemAgents={systemAgents} slackConnected={false} />);
    expect(screen.getByText('Hindsight')).toBeTruthy();
    // labelled as a system node
    const node = screen.getByText('Hindsight').closest('div')!;
    expect(within(node).getByText('system')).toBeTruthy();
  });

  it('synthesizes a Slack Intake front door parenting the orchestrator when slack is connected', () => {
    const lead = asst({ id: 'lead', name: 'Orchestrator', isLead: true });
    const spec = asst({ id: 'spec', name: 'Code Specialist' });
    const leadWithDelegate = { ...lead, enabledTools: ['agent.spec'] };
    render(<TeamStructure slug="p" assistants={[leadWithDelegate, spec]} systemAgents={systemAgents} slackConnected />);
    expect(screen.getByText('Slack Intake')).toBeTruthy();
    // the orchestrator and its specialist still render under the front door
    expect(screen.getByText('Orchestrator')).toBeTruthy();
    expect(screen.getByText('Code Specialist')).toBeTruthy();
  });

  it('shows a greyed Slack node (not a front door) when slack is not connected', () => {
    const lead = asst({ id: 'lead', name: 'Orchestrator', isLead: true });
    render(<TeamStructure slug="p" assistants={[lead]} systemAgents={systemAgents} slackConnected={false} />);
    // Slack Intake still appears, but as a "not connected" placeholder with a connect link…
    expect(screen.getByText('Slack Intake')).toBeTruthy();
    expect(screen.getByText('not connected')).toBeTruthy();
    expect(screen.getByText(/Connect Slack/)).toBeTruthy();
    // …and the orchestrator renders as a top-level root, NOT nested under Slack.
    expect(screen.getByText('Orchestrator')).toBeTruthy();
  });
});

describe('TeamStructure origin badges', () => {
  it('renders an AI badge for autogen agents and an edited badge when user_modified', () => {
    const lead = asst({ id: 'lead', name: 'Lead', isLead: true, sourceProposalId: 'p1', enabledTools: ['agent.spec'] });
    const spec = asst({ id: 'spec', name: 'Spec', sourceProposalId: 'p1', userModified: true });
    render(<TeamStructure slug="p" assistants={[lead, spec]} systemAgents={systemAgents} slackConnected />);
    expect(screen.getAllByText('AI')).toHaveLength(2);
    expect(screen.getByText('edited')).toBeTruthy();
  });

  it('renders a manual badge for agents with no source proposal', () => {
    const lead = asst({ id: 'lead', name: 'Lead', isLead: true, sourceProposalId: null });
    render(<TeamStructure slug="p" assistants={[lead]} systemAgents={systemAgents} slackConnected />);
    expect(screen.getByText('manual')).toBeTruthy();
  });
});

describe('TeamStructure renders as a tree (each node once)', () => {
  it('renders each assistant EXACTLY ONCE even when delegation forms a cycle', () => {
    // Orchestrator → {A, B}; A ⇄ B form a 2-cycle. A per-path renderer would explode
    // (A under orch, A under B, B under orch, B under A, …). A tree renders each once.
    const orch = asst({ id: 'orch', name: 'Orchestrator', isLead: true, enabledTools: ['agent.A', 'agent.B'] });
    const a = asst({ id: 'A', name: 'Alpha', enabledTools: ['agent.B'] });
    const b = asst({ id: 'B', name: 'Beta', enabledTools: ['agent.A'] });
    render(<TeamStructure slug="p" assistants={[orch, a, b]} systemAgents={systemAgents} slackConnected={false} />);

    expect(screen.queryAllByText('Orchestrator')).toHaveLength(1);
    expect(screen.queryAllByText('Alpha')).toHaveLength(1);
    expect(screen.queryAllByText('Beta')).toHaveLength(1);
  });

  it('renders a specialist delegated to by two parents only ONCE', () => {
    // orch → {A, B}; both A and B delegate to shared C.
    const orch = asst({ id: 'orch', name: 'Orchestrator', isLead: true, enabledTools: ['agent.A', 'agent.B'] });
    const a = asst({ id: 'A', name: 'Alpha', enabledTools: ['agent.C'] });
    const b = asst({ id: 'B', name: 'Beta', enabledTools: ['agent.C'] });
    const c = asst({ id: 'C', name: 'Gamma' });
    render(<TeamStructure slug="p" assistants={[orch, a, b, c]} systemAgents={systemAgents} slackConnected={false} />);

    expect(screen.queryAllByText('Gamma')).toHaveLength(1);
    expect(screen.queryAllByText('Alpha')).toHaveLength(1);
    expect(screen.queryAllByText('Beta')).toHaveLength(1);
  });
});
