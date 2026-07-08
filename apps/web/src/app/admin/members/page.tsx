'use client';

import { Suspense, useEffect, useState } from 'react';
import { api, type OrgInfo, type OrgInvitation, type OrgMember } from '../../../lib/api';
import { Field, Input, Select } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Avatar } from '../../../components/ui/avatar';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';

export default function AdminMembersPage() {
  return (
    <Suspense fallback={<WorkspaceShell org={null}><Skeleton rows={3} /></WorkspaceShell>}>
      <MembersView />
    </Suspense>
  );
}

type Role = OrgMember['role'];

function MembersView() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [error, setError] = useState('');
  const [roleErrors, setRoleErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<OrgInfo>('/api/org'),
      api<OrgMember[]>('/api/org/members'),
      api<OrgInvitation[]>('/api/org/invitations'),
    ])
      .then(([o, m, inv]) => {
        setOrg(o);
        setMembers(m);
        setInvitations(inv);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (e?.status === 404 || e?.status === 403) {
          setUnauthorized(true);
        } else {
          setError(e?.message ?? 'Failed to load members');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function changeRole(userId: string, role: Role) {
    setRoleErrors((prev) => ({ ...prev, [userId]: '' }));
    try {
      await api<void>(`/api/org/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMembers((xs) => xs!.map((m) => (m.userId === userId ? { ...m, role } : m)));
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      let msg: string;
      if (apiErr?.status === 422) {
        msg = apiErr.message?.includes('owner')
          ? 'Cannot demote the last owner.'
          : (apiErr.message ?? 'Validation error');
      } else if (apiErr?.status === 403) {
        msg = 'Only the owner can change owner roles.';
      } else {
        msg = err instanceof Error ? err.message : 'Failed to update role';
      }
      setRoleErrors((prev) => ({ ...prev, [userId]: msg }));
    }
  }

  if (loading) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Members" />
        <Skeleton rows={3} />
      </WorkspaceShell>
    );
  }

  if (unauthorized) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Members" />
        <EmptyState
          title="Not authorized"
          body="Only org owners and managers can manage members."
        />
      </WorkspaceShell>
    );
  }

  if (error) {
    return (
      <WorkspaceShell org={org}>
        <PageHeader title="Members" />
        <p className="text-sm text-crit">{error}</p>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell org={org}>
      <PageHeader title="Members" />

      <div className="flex flex-col gap-8">
        <InviteForm
          canInviteManagers={org?.myOrgRole === 'owner'}
          onInvited={(inv) => setInvitations((xs) => [...xs, inv])}
        />

        {members === null || members.length === 0 ? (
          <EmptyState title="No members found" body="No members are listed for this org." />
        ) : (
          <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-5 py-3">
                <Avatar label={m.email ?? m.userId} />
                <div className="flex min-w-0 flex-1 flex-col">
                  {m.email ? (
                    <span className="text-sm text-fg">{m.email}</span>
                  ) : (
                    <span className="font-mono text-sm text-fg-muted">
                      {m.userId}
                      <span className="ml-1 text-xs text-fg-faint">(no email yet)</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editingMemberId === m.userId ? (
                    <>
                      <Select
                        value={m.role}
                        onChange={(e) => {
                          void changeRole(m.userId, e.target.value as Role);
                          setEditingMemberId(null);
                        }}
                      >
                        <option value="user">User</option>
                        <option value="manager">Manager</option>
                        {/* Owner-touching changes are owner-only — hide the dead option */}
                        {org?.myOrgRole === 'owner' && <option value="owner">Owner</option>}
                      </Select>
                      <Button variant="ghost" onClick={() => setEditingMemberId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge>{m.role}</Badge>
                      <Button variant="ghost" onClick={() => setEditingMemberId(m.userId)}>
                        Edit
                      </Button>
                    </>
                  )}
                  {roleErrors[m.userId] && (
                    <span className="text-xs text-crit">{roleErrors[m.userId]}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {invitations.length > 0 && (
          <PendingInvitations
            invitations={invitations}
            onRevoked={(id) => setInvitations((xs) => xs.filter((i) => i.id !== id))}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}

function InviteForm({
  canInviteManagers,
  onInvited,
}: {
  canInviteManagers: boolean;
  onInvited: (inv: OrgInvitation) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'manager' | 'user'>('user');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');
    setSentTo('');
    try {
      await api<{ ok: true }>('/api/org/invitations', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      // Refetch instead of fabricating the row — the server owns id/expiry.
      const invitations = await api<OrgInvitation[]>('/api/org/invitations');
      const created = invitations.find((i) => i.email === email.trim().toLowerCase());
      if (created) onInvited(created);
      setSentTo(email);
      setEmail('');
      setRole('user');
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      if (apiErr?.status === 422) {
        setError(apiErr.message?.includes('member') ? 'Already a member of this org.' : 'Already invited — revoke the pending invitation to re-send.');
      } else if (apiErr?.status === 403) {
        setError('Only the owner can invite managers.');
      } else if (apiErr?.status === 429) {
        setError('Too many invitations — try again shortly.');
      } else {
        setError(apiErr?.message ?? 'Failed to send invitation');
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex max-w-xl items-end gap-2">
        <div className="flex-1">
          <Field label="Invite by email">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
          </Field>
        </div>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'user')} className="w-32">
            <option value="user">User</option>
            {canInviteManagers && <option value="manager">Manager</option>}
          </Select>
        </Field>
        <Button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send invite'}
        </Button>
      </div>
      {error && <p className="text-sm text-crit">{error}</p>}
      {sentTo && <p className="text-sm text-ok">Invitation sent to {sentTo}.</p>}
    </form>
  );
}

function PendingInvitations({
  invitations,
  onRevoked,
}: {
  invitations: OrgInvitation[];
  onRevoked: (id: string) => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function revoke(id: string) {
    setError('');
    try {
      await api<void>(`/api/org/invitations/${id}`, { method: 'DELETE' });
      onRevoked(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation');
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Pending invitations</h2>
      <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
        {invitations.map((inv) => {
          const expired = new Date(inv.expiresAt).getTime() < Date.now();
          return (
            <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar label={inv.email} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-fg">{inv.email}</span>
                <span className="text-xs text-fg-faint">
                  {expired ? 'Expired' : `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={expired ? 'warn' : 'neutral'}>{inv.role}</Badge>
                {confirmingId === inv.id ? (
                  <>
                    <Button variant="danger" onClick={() => void revoke(inv.id)}>
                      Revoke
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmingId(inv.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="text-sm text-crit">{error}</p>}
    </section>
  );
}
