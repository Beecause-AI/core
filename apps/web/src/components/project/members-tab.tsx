'use client';

import { useEffect, useState } from 'react';
import { api, type ProjectMember } from '../../lib/api';
import { Button } from '../ui/button';
import { Field, Input, Select } from '../ui/input';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import { Avatar } from '../ui/avatar';

export function MembersTab({ slug }: { slug: string }) {
  const base = `/api/org/projects/${slug}/members`;
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'admin' | 'user'>('user');
  const [memberError, setMemberError] = useState('');
  const [memberSaving, setMemberSaving] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  useEffect(() => { api<ProjectMember[]>(base).then(setMembers).catch(() => setMembers([])); }, [base]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault(); setMemberError(''); setMemberSaving(true);
    try {
      await api<void>(base, { method: 'POST', body: JSON.stringify({ email: memberEmail, role: memberRole }) });
      setMemberEmail('');
      setMembers(await api<ProjectMember[]>(base));
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      if (apiErr?.status === 422) {
        setMemberError(
          apiErr.message?.includes('sign in') || apiErr.message?.includes('once')
            ? "This user hasn't signed in yet. Ask them to log in first."
            : (apiErr.message ?? 'Validation error'),
        );
      } else {
        setMemberError(err instanceof Error ? err.message : 'Failed to add member');
      }
    } finally { setMemberSaving(false); }
  }

  async function changeMemberRole(userId: string, role: 'admin' | 'user') {
    try { await api<void>(`${base}/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }); setMembers((xs) => xs!.map((m) => (m.userId === userId ? { ...m, role } : m))); }
    catch (err) { setMemberError(err instanceof Error ? err.message : 'Failed to update role'); }
  }

  async function removeMember(userId: string) {
    if (!confirm('Remove this member from the project?')) return;
    try { await api<void>(`${base}/${userId}`, { method: 'DELETE' }); setMembers((xs) => xs!.filter((m) => m.userId !== userId)); }
    catch (err) { setMemberError(err instanceof Error ? err.message : 'Failed to remove member'); }
  }

  return (
    <section>
      <h2 className="mb-4 text-base font-semibold text-fg">Members</h2>
      {members === null ? <Skeleton rows={2} /> : members.length === 0 ? (
        <EmptyState title="No members yet" body="Add team members by email to give them access to this project." />
      ) : (
        <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 px-5 py-3">
              <Avatar label={m.email ?? m.userId} />
              <div className="flex min-w-0 flex-1 flex-col">
                {m.email ? <span className="text-sm text-fg">{m.email}</span> : (
                  <span className="font-mono text-sm text-fg-muted">{m.userId}<span className="ml-1 text-xs text-fg-faint">(no email yet)</span></span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {editingMemberId === m.userId ? (
                  <>
                    <Select value={m.role} onChange={(e) => { void changeMemberRole(m.userId, e.target.value as 'admin' | 'user'); setEditingMemberId(null); }}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </Select>
                    <Button variant="ghost" onClick={() => setEditingMemberId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Badge>{m.role}</Badge>
                    <Button variant="ghost" onClick={() => setEditingMemberId(m.userId)}>Edit</Button>
                  </>
                )}
                <Button variant="danger" onClick={() => removeMember(m.userId)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {memberError && <p className="mt-2 text-sm text-crit">{memberError}</p>}
      <form onSubmit={addMember} className="mt-4 flex max-w-md flex-col gap-4">
        <Field label="Add by email"><Input type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="teammate@example.com" required /></Field>
        <Field label="Role">
          <Select value={memberRole} onChange={(e) => setMemberRole(e.target.value as 'admin' | 'user')}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </Select>
        </Field>
        <div className="flex justify-end"><Button type="submit" disabled={memberSaving}>{memberSaving ? 'Adding…' : 'Add member'}</Button></div>
      </form>
    </section>
  );
}
