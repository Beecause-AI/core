import { registerSignalSkill } from '../registry.js';
import type { SignalSkill, SignalSpec } from '../types.js';

const metric = (description: string, hint?: Record<string, string>): SignalSpec =>
  ({ kind: 'metric', integration: 'gcp', tool: 'integration.gcp.query_metrics', description, hint });
const logs: SignalSpec = { kind: 'log', integration: 'gcp', tool: 'integration.gcp.query_logs', description: 'Cloud Logging entries' };

export const GCP_SKILLS: SignalSkill[] = [
  { id: 'gcp-cloud-run', product: 'cloud-run', integration: 'gcp', title: 'Cloud Run service',
    markers: { contentPatterns: ['gcp\\.cloudrunv2\\.Service', 'run\\.googleapis\\.com', 'gcloud run deploy'] },
    signals: [metric('request count, latency, 5xx, instance count, CPU/memory', { resource: 'cloud_run_revision' }), logs] },
  { id: 'gcp-cloud-run-jobs', product: 'cloud-run-jobs', integration: 'gcp', title: 'Cloud Run Jobs',
    markers: { contentPatterns: ['gcp\\.cloudrunv2\\.Job', 'gcloud run jobs'] },
    signals: [metric('job executions, completion, failures', { resource: 'cloud_run_job' }), logs] },
  { id: 'gcp-cloud-run-worker-pools', product: 'cloud-run-worker-pools', integration: 'gcp', title: 'Cloud Run Worker Pools',
    markers: { contentPatterns: ['WorkerPool', 'worker-pools'] },
    signals: [metric('worker pool instance count & utilization', { resource: 'cloud_run_worker_pool' }), logs] },
  { id: 'gcp-cloud-functions', product: 'cloud-functions', integration: 'gcp', title: 'Cloud Functions',
    markers: { deps: ['@google-cloud/functions-framework'], contentPatterns: ['gcp\\.cloudfunctions', 'gcloud functions deploy'] },
    signals: [metric('invocations, execution time, errors', { resource: 'cloud_function' }), logs] },
  { id: 'gcp-cloud-scheduler', product: 'cloud-scheduler', integration: 'gcp', title: 'Cloud Scheduler',
    markers: { contentPatterns: ['gcp\\.cloudscheduler', 'gcloud scheduler'] },
    signals: [metric('job attempts & failures', { resource: 'cloud_scheduler_job' }), logs] },
  { id: 'gcp-pubsub', product: 'pubsub', integration: 'gcp', title: 'Pub/Sub',
    markers: { deps: ['@google-cloud/pubsub'], contentPatterns: ['gcp\\.pubsub\\.(Topic|Subscription)'] },
    signals: [metric('oldest unacked age, backlog, delivery & ack rates, DLQ', { resource: 'pubsub_subscription' }), logs] },
  { id: 'gcp-load-balancer', product: 'load-balancer', integration: 'gcp', title: 'Cloud Load Balancing',
    markers: { contentPatterns: ['gcp\\.compute\\.(UrlMap|BackendService|GlobalForwardingRule|TargetHttpsProxy)'] },
    signals: [metric('request count, latency, 5xx, backend health', { resource: 'https_lb_rule' }), logs] },
  { id: 'gcp-memorystore', product: 'memorystore', integration: 'gcp', title: 'Memorystore (Redis/Memcached)',
    markers: { deps: ['ioredis', 'redis'], contentPatterns: ['gcp\\.redis\\.Instance', 'memorystore'] },
    signals: [metric('memory usage, evictions, connections, hit rate', { resource: 'redis_instance' })] },
  { id: 'gcp-firestore', product: 'firestore', integration: 'gcp', title: 'Firestore',
    markers: { deps: ['@google-cloud/firestore'], depPrefixes: ['firebase-admin'], contentPatterns: ['\\.firestore\\('] },
    signals: [metric('read/write/delete ops, latency', { resource: 'firestore_instance' }), logs] },
  { id: 'gcp-firebase', product: 'firebase', integration: 'gcp', title: 'Firebase',
    markers: { deps: ['firebase', 'firebase-admin'], filePatterns: ['firebase\\.json$'] },
    signals: [metric('Firebase Hosting/Auth/Functions usage via Cloud Monitoring'), logs] },
];

for (const s of GCP_SKILLS) registerSignalSkill(s);
