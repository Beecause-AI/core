const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal dark branded verification email. Token hex mirrors the web-design system. */
export function verifyEmailHtml({ name, url }: { name: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#0A0A0B;color:#EDEDEF;font-family:Inter,Arial,sans-serif;padding:40px">
  <div style="max-width:480px;margin:0 auto;background:#131316;border:1px solid #26262B;border-radius:12px;padding:32px">
    <div style="font-weight:600;font-size:16px;color:#EDEDEF">◆ Beecause</div>
    <h1 style="font-size:20px;margin:24px 0 8px">Verify your email</h1>
    <p style="color:#8B8B93;font-size:14px;margin:0 0 24px">Hi ${esc(name)}, confirm your email to finish setting up your Beecause account.</p>
    <a href="${url}" style="display:inline-block;background:#F6B73C;color:#0d0e10;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:6px">Verify email →</a>
    <p style="color:#5D5D66;font-size:12px;margin:24px 0 0">Or paste this link: ${esc(url)}</p>
  </div></body></html>`;
}

/** Org-member invitation: invitee clicks through to the org host to join. */
export function inviteEmailHtml(
  { inviterEmail, orgName, role, url }: { inviterEmail: string; orgName: string; role: string; url: string },
): string {
  return `<!doctype html><html><body style="margin:0;background:#0A0A0B;color:#EDEDEF;font-family:Inter,Arial,sans-serif;padding:40px">
  <div style="max-width:480px;margin:0 auto;background:#131316;border:1px solid #26262B;border-radius:12px;padding:32px">
    <div style="font-weight:600;font-size:16px;color:#EDEDEF">◆ Beecause</div>
    <h1 style="font-size:20px;margin:24px 0 8px">Join ${esc(orgName)}</h1>
    <p style="color:#8B8B93;font-size:14px;margin:0 0 24px">${esc(inviterEmail)} invited you to join <strong style="color:#EDEDEF">${esc(orgName)}</strong> on Beecause as a ${esc(role)}. This invitation expires in 7 days.</p>
    <a href="${url}" style="display:inline-block;background:#F6B73C;color:#0d0e10;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:6px">Accept invitation →</a>
    <p style="color:#5D5D66;font-size:12px;margin:24px 0 0">Or paste this link: ${esc(url)}</p>
  </div></body></html>`;
}

/** Sent when someone tries to sign up with an already-verified email. Keeps the
 *  signup response uniform (no enumeration) AND equalizes timing (both branches
 *  send exactly one email), while nudging the existing user to sign in. */
export function accountExistsHtml({ name, loginUrl }: { name: string; loginUrl: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#0A0A0B;color:#EDEDEF;font-family:Inter,Arial,sans-serif;padding:40px">
  <div style="max-width:480px;margin:0 auto;background:#131316;border:1px solid #26262B;border-radius:12px;padding:32px">
    <div style="font-weight:600;font-size:16px;color:#EDEDEF">◆ Beecause</div>
    <h1 style="font-size:20px;margin:24px 0 8px">You already have an account</h1>
    <p style="color:#8B8B93;font-size:14px;margin:0 0 24px">Hi ${esc(name)}, someone (probably you) tried to sign up with this email — but you already have a Beecause account. Just sign in. If you've forgotten your password, use "Forgot password" on the sign-in page.</p>
    <a href="${loginUrl}" style="display:inline-block;background:#F6B73C;color:#0d0e10;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:6px">Sign in →</a>
  </div></body></html>`;
}
