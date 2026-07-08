export function PagerDutyStepInstructions() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-5 text-sm text-fg-muted">
      <p className="font-medium text-fg">Grant read-only access</p>
      <ol className="flex flex-col gap-2 pl-4 list-decimal">
        <li>
          In your PagerDuty account, go to{' '}
          <span className="font-medium text-fg">Integrations → API Access Keys</span> and click{' '}
          <span className="font-medium text-fg">Create New API Key</span>.
        </li>
        <li>
          Give the key a description (e.g.{' '}
          <span className="font-mono text-fg">Beecause read-only</span>), check{' '}
          <span className="font-medium text-fg">Read-only API Key</span>, then click{' '}
          <span className="font-medium text-fg">Create Key</span>. Copy the key value — it is shown once.
        </li>
        <li>
          Choose the <span className="font-medium text-fg">Region</span> that matches your PagerDuty account:{' '}
          <span className="font-medium text-fg">US</span> if your account URL is{' '}
          <span className="font-mono text-fg">app.pagerduty.com</span>,{' '}
          <span className="font-medium text-fg">EU</span> if it is{' '}
          <span className="font-mono text-fg">app.eu.pagerduty.com</span>.
        </li>
        <li>
          Paste the token above, save, then click <span className="font-medium text-fg">Verify</span> to confirm
          that alerts (incidents) are reachable.
        </li>
      </ol>
    </div>
  );
}
