import { Suspense } from 'react';
import { FeatureSettings } from '../../../components/org/feature-settings';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { Skeleton } from '../../../components/ui/skeleton';

export default function AdminFeaturesPage() {
  return (
    <Suspense fallback={<WorkspaceShell org={null}><Skeleton rows={2} /></WorkspaceShell>}>
      <FeatureSettings />
    </Suspense>
  );
}
