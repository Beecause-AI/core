export function DatadogStepInstructions() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5 text-sm text-fg-muted">
      <p className="font-medium text-fg">Grant read-only access</p>
      <ol className="flex flex-col gap-2 pl-4 list-decimal">
        <li>
          In your Datadog account, go to <span className="font-medium text-fg">Organization Settings → API Keys</span>{' '}
          and create a new API key. Copy the key value — it is shown once.
        </li>
        <li>
          Go to <span className="font-medium text-fg">Organization Settings → Application Keys</span> and create a new
          Application key. Grant it the following scopes:{' '}
          <span className="font-mono text-fg">metrics_read</span>,{' '}
          <span className="font-mono text-fg">logs_read_data</span>,{' '}
          <span className="font-mono text-fg">apm_read</span>,{' '}
          <span className="font-mono text-fg">monitors_read</span>.
        </li>
        <li>
          Choose the <span className="font-medium text-fg">Site</span> that matches your Datadog organization{' '}
          (visible in your browser URL — e.g. <span className="font-mono text-fg">app.datadoghq.com</span> → US1,{' '}
          <span className="font-mono text-fg">app.datadoghq.eu</span> → EU).
        </li>
        <li>
          Paste both keys above, save, then click <span className="font-medium text-fg">Verify</span> to confirm
          which signals (metrics, logs, traces, monitors) are reachable.
        </li>
      </ol>
    </div>
  );
}
