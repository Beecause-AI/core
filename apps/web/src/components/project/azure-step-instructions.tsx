export function AzureStepInstructions() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5 text-sm text-fg-muted">
      <p className="font-medium text-fg">Grant read-only access</p>
      <ol className="flex flex-col gap-2 pl-4 list-decimal">
        <li>Register a Microsoft Entra app (or reuse one). Note its <span className="font-medium text-fg">Directory (tenant) ID</span> and <span className="font-medium text-fg">Application (client) ID</span>.</li>
        <li>Assign it the <span className="font-mono text-fg">Monitoring Reader</span> role on each subscription, and <span className="font-mono text-fg">Log Analytics Reader</span> on each Log Analytics / Application Insights workspace.</li>
        <li><span className="font-medium text-fg">Service principal:</span> create a client secret and paste it here.</li>
        <li><span className="font-medium text-fg">Workload identity:</span> after saving, add a federated credential to the app whose subject matches the generated Federation subject.</li>
        <li>Set a default subscription (and optionally a workspace), save, then click <span className="font-medium text-fg">Verify</span> to confirm which signals are reachable.</li>
      </ol>
    </div>
  );
}
