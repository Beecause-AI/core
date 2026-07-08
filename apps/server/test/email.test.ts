import { describe, expect, it, vi } from 'vitest';
import { makeResendSender } from '../src/integrations/email/resend.js';
import { verifyEmailHtml } from '../src/integrations/email/templates.js';

describe('resend sender', () => {
  it('POSTs to the resend API with from + bearer', async () => {
    let body: any; let auth: string | null = null;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(init!.body as string); auth = new Headers(init!.headers).get('authorization');
      return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
    });
    const send = makeResendSender({ apiKey: 'K', from: 'no-reply@beecause.ai' }, fetcher as unknown as typeof fetch);
    await send.send({ to: 'a@b.co', subject: 'Hi', html: '<p>x</p>' });
    expect(body.from).toBe('no-reply@beecause.ai');
    expect(body.to).toBe('a@b.co');
    expect(auth).toBe('Bearer K');
  });
  it('throws on a non-2xx response', async () => {
    const fetcher = vi.fn(async () => new Response('bad', { status: 422 }));
    const send = makeResendSender({ apiKey: 'K', from: 'f@x.dev' }, fetcher as unknown as typeof fetch);
    await expect(send.send({ to: 'a@b.co', subject: 's', html: 'h' })).rejects.toThrow(/422/);
  });
});

describe('verifyEmailHtml', () => {
  it('embeds the url and escapes the name', () => {
    const html = verifyEmailHtml({ name: '<b>Jo</b>', url: 'https://beecause.ai/verify?token=abc' });
    expect(html).toContain('https://beecause.ai/verify?token=abc');
    expect(html).toContain('&lt;b&gt;Jo&lt;/b&gt;');
    expect(html).not.toContain('<b>Jo</b>');
  });
});
