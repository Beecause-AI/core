import { describe, expect, it, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CloudWatchClient, GetMetricDataCommand, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { realAwsClient, resolveWindow } from '../src/aws/client.js';

const creds = { accessKeyId: 'AKIA', secretAccessKey: 's' };
const cw = mockClient(CloudWatchClient);
const sts = mockClient(STSClient);

beforeEach(() => { cw.reset(); sts.reset(); });

describe('resolveWindow', () => {
  it('resolves a relative window to start/end', () => {
    const now = new Date('2026-06-25T12:00:00Z');
    const { start, end } = resolveWindow({ window: '1h', now });
    expect(end.toISOString()).toBe('2026-06-25T12:00:00.000Z');
    expect(start.toISOString()).toBe('2026-06-25T11:00:00.000Z');
  });
});

describe('realAwsClient', () => {
  it('getCallerIdentity returns the account id', async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Account: '111122223333' });
    expect(await realAwsClient.getCallerIdentity(creds, 'us-east-1')).toEqual({ accountId: '111122223333' });
  });

  it('queryMetrics sends GetMetricData with a built query and returns results', async () => {
    cw.on(GetMetricDataCommand).resolves({ MetricDataResults: [{ Id: 'm0', Values: [1, 2, 3] }] });
    const out = await realAwsClient.queryMetrics(creds, 'us-east-1', {
      namespace: 'AWS/ApplicationELB', metricName: 'HTTPCode_Target_5XX_Count',
      dimensions: [{ name: 'LoadBalancer', value: 'app/x/1' }], stat: 'Sum', period: 300, window: '1h',
      now: new Date('2026-06-25T12:00:00Z'),
    });
    expect((out as any).MetricDataResults[0].Values).toEqual([1, 2, 3]);
    const call = cw.commandCalls(GetMetricDataCommand)[0]!.args[0].input as any;
    expect(call.MetricDataQueries[0].MetricStat.Metric.Namespace).toBe('AWS/ApplicationELB');
    expect(call.MetricDataQueries[0].MetricStat.Stat).toBe('Sum');
  });

  it('listAlarms sends DescribeAlarms and returns alarms', async () => {
    cw.on(DescribeAlarmsCommand).resolves({ MetricAlarms: [{ AlarmName: 'a', StateValue: 'ALARM' }] });
    const out = await realAwsClient.listAlarms(creds, 'us-east-1', { stateValue: 'ALARM' });
    expect((out as any).MetricAlarms[0].AlarmName).toBe('a');
  });
});
