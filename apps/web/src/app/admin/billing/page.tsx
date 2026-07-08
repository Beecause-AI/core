import { Suspense } from 'react';
import { BillingSettings } from '../../../components/org/billing-settings';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { Skeleton } from '../../../components/ui/skeleton';

export default function AdminBillingPage() {
  return (
    <Suspense fallback={<WorkspaceShell org={null}><Skeleton rows={3} /></WorkspaceShell>}>
      <BillingSettings />
    </Suspense>
  );
}
