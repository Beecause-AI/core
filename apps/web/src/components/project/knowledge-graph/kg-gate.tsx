import { EmptyState } from '../../ui/empty-state';
import { Button } from '../../ui/button';
import { integrationProviderHref } from '../../../lib/project-path';

export function KgGate({ slug }: { slug: string }) {
  return (
    <EmptyState
      mark
      title="Connect a repository to build your Knowledge Graph"
      body="The Knowledge Graph is derived from your code. Connect a GitHub repository to this project to map its structure and business flows."
      action={
        <Button onClick={() => { window.location.href = integrationProviderHref(slug, 'github'); }}>
          Connect GitHub
        </Button>
      }
    />
  );
}
