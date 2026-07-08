import { describe, expect, it } from 'vitest';
import { resolveApprovalRequired } from '../src/approval.js';

describe('resolveApprovalRequired', () => {
  it('read tools never gate', () => {
    const req = resolveApprovalRequired(null, null);
    expect(req('builtin.add', false)).toBe(false);
  });
  it('default (no policies) does NOT require approval for write tools', () => {
    const req = resolveApprovalRequired(null, null);
    expect(req('mcp.write', true)).toBe(false);
  });
  it('org policy overrides project policy wholesale', () => {
    const req = resolveApprovalRequired({ writeToolsRequireApproval: false }, { writeToolsRequireApproval: true });
    expect(req('mcp.write', true)).toBe(false); // org wins
  });
  it('falls back to project policy when no org policy', () => {
    const req = resolveApprovalRequired(null, { writeToolsRequireApproval: false });
    expect(req('mcp.write', true)).toBe(false);
  });
  it('per-tool override wins over the default', () => {
    const req = resolveApprovalRequired({ writeToolsRequireApproval: true, overrides: { 'mcp.safe': false } }, null);
    expect(req('mcp.safe', true)).toBe(false);
    expect(req('mcp.other', true)).toBe(true);
  });
});
