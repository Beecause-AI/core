export interface EmailSender { send(input: { to: string; subject: string; html: string }): Promise<void> }
export interface ResendConfig { apiKey: string; from: string }

export function makeResendSender(cfg: ResendConfig, fetcher: typeof fetch = fetch): EmailSender {
  return {
    async send({ to, subject, html }) {
      const res = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: cfg.from, to, subject, html }),
      });
      if (!res.ok) throw new Error(`resend → ${res.status}: ${await res.text()}`);
    },
  };
}
