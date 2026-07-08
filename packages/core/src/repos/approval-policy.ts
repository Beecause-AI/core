import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { toDoc } from '../store/codec.js';

export interface ApprovalPolicy {
  writeToolsRequireApproval: boolean;
  overrides?: Record<string, boolean>;
}

export async function getOrgApprovalPolicy(db: Db, orgId: string): Promise<ApprovalPolicy | null> {
  const snap = await col(db, 'organizations').doc(orgId).get();
  if (!snap.exists) return null;
  return (snap.data()?.approvalPolicy as ApprovalPolicy | null | undefined) ?? null;
}

export async function getProjectApprovalPolicy(db: Db, projectId: string): Promise<ApprovalPolicy | null> {
  const snap = await col(db, 'projects').doc(projectId).get();
  if (!snap.exists) return null;
  return (snap.data()?.approvalPolicy as ApprovalPolicy | null | undefined) ?? null;
}

export async function setProjectApprovalPolicy(db: Db, projectId: string, policy: ApprovalPolicy | null): Promise<void> {
  await col(db, 'projects').doc(projectId).update(toDoc({ approvalPolicy: policy }));
}
