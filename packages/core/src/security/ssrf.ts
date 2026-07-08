/** Reject user-supplied custom base URLs that could target internal/metadata endpoints (SSRF). */
export function assertSafeBaseUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('invalid base url'); }
  if (u.protocol !== 'https:') throw new Error('base url must be https');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host === 'metadata.google.internal') {
    throw new Error('base url host not allowed');
  }
  // Reject ALL IPv6 literals — legitimate provider endpoints use hostnames, and parsing
  // every IPv6 class (loopback ::1, IPv4-mapped ::ffff:*, ULA fc00::/7, link-local fe80::/10)
  // is error-prone. (Note: this is a string-level guard; it does not resolve DNS, so a public
  // hostname that resolves to a private IP is out of scope — defense for that belongs at the
  // egress/network layer.)
  if (host.includes(':')) throw new Error('base url host not allowed');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && (b as number) >= 16 && (b as number) <= 31)) {
      throw new Error('base url host not allowed');
    }
  }
  return u;
}
