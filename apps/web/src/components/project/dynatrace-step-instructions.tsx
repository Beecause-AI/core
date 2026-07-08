export function DynatraceStepInstructions() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5 text-sm text-fg-muted">
      <p className="font-medium text-fg">Grant read-only access</p>
      <ol className="flex flex-col gap-2 pl-4 list-decimal">
        <li>
          In your Dynatrace environment, go to{' '}
          <span className="font-medium text-fg">Settings → Access Tokens → Generate new token</span>.
        </li>
        <li>
          Grant the following scopes:{' '}
          <span className="font-mono text-fg">metrics.read</span>,{' '}
          <span className="font-mono text-fg">logs.read</span>,{' '}
          <span className="font-mono text-fg">problems.read</span>,{' '}
          <span className="font-mono text-fg">entities.read</span>.
          Copy the token value — it is shown once.
        </li>
        <li>
          Copy your <span className="font-medium text-fg">environment URL</span> from the address bar{' '}
          (e.g. <span className="font-mono text-fg">https://abc12345.live.dynatrace.com</span>).
        </li>
        <li>
          Paste the token and URL above, save, then click{' '}
          <span className="font-medium text-fg">Verify</span> to confirm which signals (metrics, logs, problems)
          are reachable.
        </li>
      </ol>
    </div>
  );
}
