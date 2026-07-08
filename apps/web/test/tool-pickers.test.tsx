// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ToolPicker } from '../src/components/project/tool-picker';
import { SubAssistantPicker } from '../src/components/project/sub-assistant-picker';
import type { Assistant, IntegrationTool, McpTool } from '../src/lib/api';

afterEach(() => cleanup());

const mcp: McpTool[] = [
  { name: 'mcp.acme.search', kind: 'mcp', mutates: false, description: 'Search the index.' },
];

describe('ToolPicker', () => {
  test('groups start collapsed; expanding reveals the humanized tool + description', () => {
    render(<ToolPicker mcpTools={mcp} value={[]} onChange={() => {}} />);
    expect(screen.getByText('MCP · acme')).toBeDefined();
    expect(screen.queryByText('Search the index.')).toBeNull(); // collapsed
    fireEvent.click(screen.getByText('MCP · acme'));
    expect(screen.getByText('Search')).toBeDefined();
    expect(screen.getByText('Search the index.')).toBeDefined();
  });

  test('toggling an MCP tool adds its namespaced name', () => {
    const onChange = vi.fn();
    render(<ToolPicker mcpTools={mcp} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('MCP · acme')); // expand
    fireEvent.click(screen.getByText('Search'));
    expect(onChange).toHaveBeenCalledWith(['mcp.acme.search']);
  });

  test('toggling an already-selected tool removes it', () => {
    const onChange = vi.fn();
    render(<ToolPicker mcpTools={mcp} value={['mcp.acme.search']} onChange={onChange} />);
    fireEvent.click(screen.getByText('MCP · acme')); // expand
    fireEvent.click(screen.getByText('Search'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  test('select all toggles every tool in a group', () => {
    const onChange = vi.fn();
    render(<ToolPicker mcpTools={mcp} value={[]} onChange={onChange} />);
    // first group is MCP · acme (Memory also has its own "Select all")
    fireEvent.click(screen.getAllByText('Select all')[0]);
    expect(onChange).toHaveBeenCalledWith(['mcp.acme.search']);
  });

  test('always shows the Memory group (recall) and never builtin.add', () => {
    render(<ToolPicker mcpTools={[]} value={[]} onChange={() => {}} />);
    expect(screen.queryByText('Built-in')).toBeNull();
    expect(screen.getByText('Memory')).toBeDefined();
    fireEvent.click(screen.getByText('Memory')); // expand
    expect(screen.getByText('Recall')).toBeDefined();
    expect(screen.queryByText('Add')).toBeNull();
  });

  test('filter expands matching groups and hides the rest', () => {
    render(<ToolPicker mcpTools={mcp} value={[]} onChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Filter tools…'), { target: { value: 'index' } });
    expect(screen.getByText('Search the index.')).toBeDefined(); // matched group force-expanded
    expect(screen.queryByText('Memory')).toBeNull(); // non-matching group hidden
  });
});

const integrationToolFixtures: IntegrationTool[] = [
  { name: 'integration.github.get_file', mutates: false, description: 'Read a file at the project ref.' },
  { name: 'integration.slack.post_message', mutates: true, description: 'Post a message to a channel.' },
  { name: 'integration.knowledge-graph.list_flows', mutates: false, description: 'List business flows.' },
];

describe('ToolPicker integrationTools', () => {
  test('groups by integration with human-readable titles and descriptions', () => {
    render(<ToolPicker mcpTools={[]} integrationTools={integrationToolFixtures} value={[]} onChange={() => {}} />);
    expect(screen.getByText('GitHub')).toBeDefined();
    expect(screen.getByText('Slack')).toBeDefined();
    fireEvent.click(screen.getByText('GitHub'));
    expect(screen.getByText('Get file')).toBeDefined();
    expect(screen.getByText('Read a file at the project ref.')).toBeDefined();
    fireEvent.click(screen.getByText('Slack'));
    expect(screen.getByText('Post message')).toBeDefined();
    expect(screen.getByText('Post a message to a channel.')).toBeDefined();
  });

  test('toggling an integration tool adds its full namespaced name', () => {
    const onChange = vi.fn();
    render(<ToolPicker mcpTools={[]} integrationTools={integrationToolFixtures} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('GitHub')); // expand
    fireEvent.click(screen.getByText('Get file'));
    expect(onChange).toHaveBeenCalledWith(['integration.github.get_file']);
  });

  test('toggling an already-selected integration tool removes it', () => {
    const onChange = vi.fn();
    render(<ToolPicker mcpTools={[]} integrationTools={integrationToolFixtures} value={['integration.github.get_file']} onChange={onChange} />);
    fireEvent.click(screen.getByText('GitHub')); // expand
    fireEvent.click(screen.getByText('Get file'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  test('Knowledge Graph group renders with a reads chip', () => {
    render(<ToolPicker mcpTools={[]} integrationTools={integrationToolFixtures} value={[]} onChange={() => {}} />);
    expect(screen.getByText('Knowledge Graph')).toBeDefined();
    fireEvent.click(screen.getByText('Knowledge Graph')); // expand
    expect(screen.getByText('List flows')).toBeDefined();
    expect(screen.getByText('List business flows.')).toBeDefined();
    // reads chip (mutates: false) — multiple chips exist; confirm at least one 'reads' chip is present
    const chips = screen.getAllByText('reads');
    expect(chips.length).toBeGreaterThan(0);
  });

  test('omits a provider group when it has no tools', () => {
    render(<ToolPicker mcpTools={[]} integrationTools={[]} value={[]} onChange={() => {}} />);
    expect(screen.queryByText('GitHub')).toBeNull();
    expect(screen.queryByText('Slack')).toBeNull();
  });
});

const siblings: Assistant[] = [
  { id: 'a1', name: 'Summarizer', persona: '', model: 'claude-sonnet-4-6', provider: 'anthropic', enabledTools: [] },
  { id: 'a2', name: 'Coder', persona: '', model: 'gemini-3-flash-preview', provider: 'platform', enabledTools: [] },
];

describe('SubAssistantPicker', () => {
  test('toggling a sibling adds agent.<id>', () => {
    const onChange = vi.fn();
    render(<SubAssistantPicker siblings={siblings} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('Summarizer'));
    expect(onChange).toHaveBeenCalledWith(['agent.a1']);
  });

  test('toggling an enabled sibling removes its agent entry', () => {
    const onChange = vi.fn();
    render(<SubAssistantPicker siblings={siblings} value={['agent.a1']} onChange={onChange} />);
    fireEvent.click(screen.getByText('Summarizer'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  test('empty state when no siblings', () => {
    render(<SubAssistantPicker siblings={[]} value={[]} onChange={() => {}} />);
    expect(screen.getByText(/no other assistants/i)).toBeDefined();
  });
});
