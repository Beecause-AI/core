import { CloudWatchClient, GetMetricDataCommand, ListMetricsCommand, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { XRayClient, GetTraceSummariesCommand, BatchGetTracesCommand } from '@aws-sdk/client-xray';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import type { ResolvedAwsCreds } from './auth.js';

export interface AwsWindow { window?: string; start?: string; end?: string; now?: Date }

const MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Resolve a relative window ('15m','1h','7d') or explicit start/end to Date objects. */
export function resolveWindow(w: AwsWindow): { start: Date; end: Date } {
  const end = w.end ? new Date(w.end) : (w.now ?? new Date());
  if (w.start) return { start: new Date(w.start), end };
  const m = /^(\d+)([smhd])$/.exec(w.window ?? '1h');
  const span = m ? Number(m[1]) * MS[m[2] as keyof typeof MS] : MS.h;
  return { start: new Date(end.getTime() - span), end };
}

export interface MetricQuery extends AwsWindow {
  namespace: string; metricName: string;
  dimensions?: { name: string; value: string }[];
  stat?: string; period?: number; extendedStatistic?: string;
}

export interface AwsClient {
  getCallerIdentity(creds: ResolvedAwsCreds, region: string): Promise<{ accountId: string | undefined }>;
  queryMetrics(creds: ResolvedAwsCreds, region: string, p: MetricQuery): Promise<unknown>;
  listMetrics(creds: ResolvedAwsCreds, region: string, p: { namespace?: string; metricName?: string }): Promise<unknown>;
  queryLogs(creds: ResolvedAwsCreds, region: string, p: AwsWindow & { logGroupNames: string[]; query: string; limit?: number }): Promise<unknown>;
  listLogGroups(creds: ResolvedAwsCreds, region: string, p: { prefix?: string; limit?: number }): Promise<unknown>;
  listTraces(creds: ResolvedAwsCreds, region: string, p: AwsWindow & { filter?: string }): Promise<unknown>;
  getTrace(creds: ResolvedAwsCreds, region: string, p: { traceIds: string[] }): Promise<unknown>;
  listAlarms(creds: ResolvedAwsCreds, region: string, p: { stateValue?: string; prefix?: string; limit?: number }): Promise<unknown>;
}

const cw = (creds: ResolvedAwsCreds, region: string) => new CloudWatchClient({ region, credentials: creds });
const cwl = (creds: ResolvedAwsCreds, region: string) => new CloudWatchLogsClient({ region, credentials: creds });
const xray = (creds: ResolvedAwsCreds, region: string) => new XRayClient({ region, credentials: creds });
const sts = (creds: ResolvedAwsCreds, region: string) => new STSClient({ region, credentials: creds });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const realAwsClient: AwsClient = {
  async getCallerIdentity(creds, region) {
    const out = await sts(creds, region).send(new GetCallerIdentityCommand({}));
    return { accountId: out.Account };
  },

  async queryMetrics(creds, region, p) {
    const { start, end } = resolveWindow(p);
    const stat = p.stat ?? 'Average';
    return cw(creds, region).send(new GetMetricDataCommand({
      StartTime: start, EndTime: end,
      MetricDataQueries: [{
        Id: 'm0', ReturnData: true,
        MetricStat: {
          Metric: {
            Namespace: p.namespace, MetricName: p.metricName,
            Dimensions: (p.dimensions ?? []).map((d) => ({ Name: d.name, Value: d.value })),
          },
          Period: p.period ?? 300,
          ...(p.extendedStatistic ? { Stat: p.extendedStatistic } : { Stat: stat }),
        },
      }],
    }));
  },

  async listMetrics(creds, region, p) {
    return cw(creds, region).send(new ListMetricsCommand({
      Namespace: p.namespace, MetricName: p.metricName,
    }));
  },

  async queryLogs(creds, region, p) {
    const { start, end } = resolveWindow(p);
    const client = cwl(creds, region);
    const started = await client.send(new StartQueryCommand({
      logGroupNames: p.logGroupNames,
      startTime: Math.floor(start.getTime() / 1000), endTime: Math.floor(end.getTime() / 1000),
      queryString: p.query, limit: p.limit ?? 50,
    }));
    const queryId = started.queryId!;
    // Logs Insights is async: poll until the query leaves the Running/Scheduled state.
    for (let i = 0; i < 30; i++) {
      const res = await client.send(new GetQueryResultsCommand({ queryId }));
      if (res.status && res.status !== 'Running' && res.status !== 'Scheduled') {
        return { status: res.status, statistics: res.statistics, results: res.results };
      }
      await sleep(500);
    }
    return { status: 'Timeout', results: [] };
  },

  async listLogGroups(creds, region, p) {
    return cwl(creds, region).send(new DescribeLogGroupsCommand({
      logGroupNamePrefix: p.prefix, limit: p.limit ?? 50,
    }));
  },

  async listTraces(creds, region, p) {
    const { start, end } = resolveWindow(p);
    return xray(creds, region).send(new GetTraceSummariesCommand({
      StartTime: start, EndTime: end, ...(p.filter ? { FilterExpression: p.filter } : {}),
    }));
  },

  async getTrace(creds, region, p) {
    return xray(creds, region).send(new BatchGetTracesCommand({ TraceIds: p.traceIds }));
  },

  async listAlarms(creds, region, p) {
    return cw(creds, region).send(new DescribeAlarmsCommand({
      ...(p.stateValue ? { StateValue: p.stateValue as any } : {}),
      ...(p.prefix ? { AlarmNamePrefix: p.prefix } : {}),
      MaxRecords: p.limit ?? 50,
    }));
  },
};

export const makeAwsClientForTest = (overrides: Partial<AwsClient>): AwsClient => ({ ...realAwsClient, ...overrides });
