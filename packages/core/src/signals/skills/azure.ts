import { registerSignalSkill } from '../registry.js';
import type { SignalSkill, SignalSpec } from '../types.js';

const metric = (description: string, hint?: Record<string, string>): SignalSpec =>
  ({ kind: 'metric', integration: 'azure', tool: 'integration.azure.query_metrics', description, hint });
const logs: SignalSpec = { kind: 'log', integration: 'azure', tool: 'integration.azure.query_logs', description: 'Log Analytics (KQL)' };

export const AZURE_SKILLS: SignalSkill[] = [
  { id: 'azure-app-service', product: 'app-service', integration: 'azure', title: 'Azure App Service',
    markers: { filePatterns: ['\\.bicep$', 'azure-pipelines\\.ya?ml$'], contentPatterns: ['Microsoft.Web/sites', 'azurerm_app_service', 'azurerm_linux_web_app'] },
    signals: [metric('requests, Http5xx, response time, CPU/memory', { namespace: 'Microsoft.Web/sites' }), logs] },
  { id: 'azure-functions', product: 'functions', integration: 'azure', title: 'Azure Functions',
    markers: { deps: ['@azure/functions', 'azure-functions'], filePatterns: ['host\\.json$', 'function\\.json$'], contentPatterns: ['Microsoft.Web/sites', 'FunctionApp'] },
    signals: [metric('execution count, execution units, errors', { namespace: 'Microsoft.Web/sites' }), logs] },
  { id: 'azure-aks', product: 'aks', integration: 'azure', title: 'Azure Kubernetes Service',
    markers: { contentPatterns: ['Microsoft.ContainerService/managedClusters', 'azurerm_kubernetes_cluster'] },
    signals: [metric('node CPU/memory, pod counts, restarts', { namespace: 'Microsoft.ContainerService/managedClusters' }), logs] },
  { id: 'azure-app-insights', product: 'app-insights', integration: 'azure', title: 'Application Insights',
    markers: { deps: ['applicationinsights', '@azure/monitor-opentelemetry'], contentPatterns: ['Microsoft.Insights/components', 'APPLICATIONINSIGHTS_CONNECTION_STRING'] },
    signals: [metric('requests/failed, requests/duration, dependency failures', { namespace: 'Microsoft.Insights/components' }), logs] },
  { id: 'azure-sql', product: 'sql', integration: 'azure', title: 'Azure SQL / PostgreSQL',
    markers: { deps: ['mssql', 'pg'], contentPatterns: ['Microsoft.Sql/servers', 'Microsoft.DBforPostgreSQL', 'azurerm_postgresql'] },
    signals: [metric('DTU/CPU, connections, deadlocks, storage', { namespace: 'Microsoft.Sql/servers/databases' }), logs] },
  { id: 'azure-service-bus', product: 'service-bus', integration: 'azure', title: 'Azure Service Bus',
    markers: { deps: ['@azure/service-bus'], contentPatterns: ['Microsoft.ServiceBus', 'azurerm_servicebus'] },
    signals: [metric('active messages, dead-lettered, throttled requests', { namespace: 'Microsoft.ServiceBus/namespaces' }), logs] },
  { id: 'azure-storage', product: 'storage', integration: 'azure', title: 'Azure Storage',
    markers: { deps: ['@azure/storage-blob', '@azure/storage-queue'], contentPatterns: ['Microsoft.Storage/storageAccounts', 'azurerm_storage_account'] },
    signals: [metric('transactions, e2e latency, availability, server errors', { namespace: 'Microsoft.Storage/storageAccounts' }), logs] },
];

for (const s of AZURE_SKILLS) registerSignalSkill(s);
