import type { Db } from '../db/client.js';
import { getIntegration } from '../repos/org-integrations.js';
import { listConnectionsForProject as listGcp } from '../repos/gcp-connections.js';
import { listConnectionsForProject as listCloudflare } from '../repos/cloudflare-connections.js';
import { listConnectionsForProject as listAws } from '../repos/aws-connections.js';
import { listConnectionsForProject as listAzure } from '../repos/azure-connections.js';
import { listConnectionsForProject as listDatadog } from '../repos/datadog-connections.js';
import { listConnectionsForProject as listDynatrace } from '../repos/dynatrace-connections.js';
import { listConnectionsForProject as listPagerDuty } from '../repos/pagerduty-connections.js';

export interface ConnectedIntegrations {
  github: boolean;
  slack: boolean;
  gcp: string[];        // connection names
  cloudflare: string[]; // connection names
  aws: string[];        // connection names
  azure: string[];      // connection names
  datadog: string[];    // connection names
  dynatrace: string[];  // connection names
  pagerduty: string[];  // connection names
}

export async function getConnectedIntegrations(db: Db, orgId: string, projectId: string): Promise<ConnectedIntegrations> {
  const [github, slack, gcp, cf, aws, azure, datadog, dynatrace, pagerduty] = await Promise.all([
    getIntegration(db, orgId, 'github'),
    getIntegration(db, orgId, 'slack'),
    listGcp(db, orgId, projectId),
    listCloudflare(db, orgId, projectId),
    listAws(db, orgId, projectId),
    listAzure(db, orgId, projectId),
    listDatadog(db, orgId, projectId),
    listDynatrace(db, orgId, projectId),
    listPagerDuty(db, orgId, projectId),
  ]);
  return {
    github: !!github?.enabled,
    slack: !!slack?.enabled,
    gcp: gcp.filter((c) => c.enabled).map((c) => c.name),
    cloudflare: cf.filter((c) => c.enabled).map((c) => c.name),
    aws: aws.filter((c) => c.enabled).map((c) => c.name),
    azure: azure.filter((c) => c.enabled).map((c) => c.name),
    datadog: datadog.filter((c) => c.enabled).map((c) => c.name),
    dynatrace: dynatrace.filter((c) => c.enabled).map((c) => c.name),
    pagerduty: pagerduty.filter((c) => c.enabled).map((c) => c.name),
  };
}

export function renderInventory(inv: ConnectedIntegrations): string {
  const line = (name: string, connected: boolean, detail?: string) =>
    connected ? `- ${name}: connected${detail ? ` (${detail})` : ''}` : `- ${name}: NOT connected`;
  return [
    line('github', inv.github),
    line('slack', inv.slack),
    line('gcp', inv.gcp.length > 0, inv.gcp.join(', ')),
    line('cloudflare', inv.cloudflare.length > 0, inv.cloudflare.join(', ')),
    line('aws', inv.aws.length > 0, inv.aws.join(', ')),
    line('azure', inv.azure.length > 0, inv.azure.join(', ')),
    line('datadog', inv.datadog.length > 0, inv.datadog.join(', ')),
    line('dynatrace', inv.dynatrace.length > 0, inv.dynatrace.join(', ')),
    line('pagerduty', inv.pagerduty.length > 0, inv.pagerduty.join(', ')),
  ].join('\n');
}
