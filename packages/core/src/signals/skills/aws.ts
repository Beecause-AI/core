import { registerSignalSkill } from '../registry.js';
import type { SignalSkill, SignalSpec } from '../types.js';

const metric = (description: string, hint?: Record<string, string>): SignalSpec =>
  ({ kind: 'metric', integration: 'aws', tool: 'integration.aws.query_metrics', description, hint });
const logs: SignalSpec = { kind: 'log', integration: 'aws', tool: 'integration.aws.query_logs', description: 'CloudWatch Logs Insights' };

export const AWS_SKILLS: SignalSkill[] = [
  { id: 'aws-lambda', product: 'lambda', integration: 'aws', title: 'AWS Lambda',
    markers: { deps: ['aws-lambda', '@aws-sdk/client-lambda'], filePatterns: ['serverless\\.ya?ml$', 'template\\.ya?ml$', 'samconfig\\.toml$'], contentPatterns: ['AWS::Lambda::Function', 'aws_lambda_function'] },
    signals: [metric('invocations, duration, errors, throttles, concurrency', { namespace: 'AWS/Lambda' }), logs] },
  { id: 'aws-api-gateway', product: 'api-gateway', integration: 'aws', title: 'API Gateway',
    markers: { contentPatterns: ['AWS::ApiGateway', 'aws_api_gateway', 'aws_apigatewayv2'] },
    signals: [metric('request count, 4XX/5XX, latency, integration latency', { namespace: 'AWS/ApiGateway' }), logs] },
  { id: 'aws-alb', product: 'alb', integration: 'aws', title: 'Application Load Balancer',
    markers: { contentPatterns: ['AWS::ElasticLoadBalancingV2', 'aws_lb\\b', 'application load balancer'] },
    signals: [metric('request count, target 5XX, target response time, healthy hosts', { namespace: 'AWS/ApplicationELB' }), logs] },
  { id: 'aws-ecs', product: 'ecs', integration: 'aws', title: 'ECS / Fargate',
    markers: { contentPatterns: ['AWS::ECS::', 'aws_ecs_service', 'FARGATE'] },
    signals: [metric('CPU/memory utilization, running task count', { namespace: 'AWS/ECS' }), logs] },
  { id: 'aws-rds', product: 'rds', integration: 'aws', title: 'RDS / Aurora',
    markers: { deps: ['pg', 'mysql2'], contentPatterns: ['AWS::RDS::', 'aws_rds_cluster', 'aws_db_instance'] },
    signals: [metric('connections, CPU, read/write latency, freeable memory', { namespace: 'AWS/RDS' }), logs] },
  { id: 'aws-sqs', product: 'sqs', integration: 'aws', title: 'SQS',
    markers: { deps: ['@aws-sdk/client-sqs'], contentPatterns: ['AWS::SQS::Queue', 'aws_sqs_queue'] },
    signals: [metric('messages visible, age of oldest message, sent/received/deleted', { namespace: 'AWS/SQS' }), logs] },
  { id: 'aws-dynamodb', product: 'dynamodb', integration: 'aws', title: 'DynamoDB',
    markers: { deps: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'], contentPatterns: ['AWS::DynamoDB::Table', 'aws_dynamodb_table'] },
    signals: [metric('throttled requests, consumed capacity, latency, errors', { namespace: 'AWS/DynamoDB' })] },
];

for (const s of AWS_SKILLS) registerSignalSkill(s);
