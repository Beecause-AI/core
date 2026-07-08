'use client';

const STEPS: { text: string; href?: string }[] = [
  {
    text: 'Open Cloudflare dashboard → Manage Account → Account API Tokens → Create Token → Create Custom Token.',
    href: 'https://dash.cloudflare.com/?to=/:account/api-tokens',
  },
  {
    text:
      'Grant only read permissions: Account · Account Analytics: Read, Zone · Analytics: Read, ' +
      'Zone · Logs: Read, and Account · Workers Observability: Read (Workers logs).',
  },
  { text: 'Scope the token to the specific account and zones you want to expose, then create it.' },
];

export function CloudflareStepInstructions({
  title = 'Create a read-only API Token',
}: {
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-medium text-fg">{title}</h3>
        <p className="mt-1 text-sm text-fg-muted">A scoped read-only token Beecause will use.</p>
      </div>
      <ol className="flex flex-col gap-1 text-sm text-fg-muted">
        {STEPS.map((s, i) => (
          <li key={i}>
            {i + 1}.{' '}
            {s.href ? (
              <a className="text-accent underline" href={s.href} target="_blank" rel="noreferrer">
                {s.text}
              </a>
            ) : (
              s.text
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-fg-faint">
        A legacy Global API Key (My Profile → API Tokens → Global API Key, used with your account email) also
        works but grants full access — prefer a scoped token.
      </p>
    </div>
  );
}
