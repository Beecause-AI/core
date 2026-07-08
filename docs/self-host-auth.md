# Self-Host Auth

Beecause supports three authentication backends (`AUTH_BACKEND`). This document covers
**`AUTH_BACKEND=oidc`** — delegating authentication to an external OpenID Connect provider.
For the local password backend see `docs/self-host-store.md` (hardening section).

## OIDC (Authorization Code + PKCE)

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `AUTH_BACKEND` | yes | Set to `oidc` |
| `OIDC_ISSUER` | yes | Issuer URL of your IdP, e.g. `https://accounts.google.com` or `https://auth.example.com/realms/myrealm` |
| `OIDC_CLIENT_ID` | yes | Client ID registered at the IdP |
| `OIDC_CLIENT_SECRET` | yes | Client secret from the IdP |
| `OIDC_REDIRECT_URI` | no | Override the callback URL (default: `<BASE_URL>/auth/oidc/callback`) |
| `OIDC_SCOPES` | no | Override the scope string (default: `openid email profile`) |
| `OIDC_ALLOW_UNVERIFIED_EMAIL` | no | Set to `true` ONLY for a trusted IdP that omits the `email_verified` claim (see below) |

### Register the redirect URI

In your IdP's application settings, register the following redirect / callback URI:

```
<BASE_URL>/auth/oidc/callback
```

For example, if your server is at `https://beecause.internal`, register:

```
https://beecause.internal/auth/oidc/callback
```

### User provisioning

Users are auto-provisioned into the single org on first login:

1. If a user with the same OIDC `(iss, sub)` pair exists, they are looked up by that identity.
2. If no match but the verified email matches an existing account, the OIDC identity is linked to that account (safe only because the email is already verified by I-1).
3. Otherwise a new user record is created.

`addOrgMember` is called on **every** successful login (idempotent — it is a no-op if the user is already a member), so membership is self-healing if it is ever removed out-of-band.

All provisioned users receive the `user` role. Granting `manager` or `owner` must be done manually via the admin console or the super console.

### Email verification enforcement

By default (secure), the callback rejects any login where the id_token `email_verified` claim is
not exactly `true`. This blocks provisioning of unverified email addresses from your IdP.

If your IdP is trusted and simply omits the `email_verified` claim (rather than setting it to
`false`), you can disable enforcement with:

```
OIDC_ALLOW_UNVERIFIED_EMAIL=true
```

Only set this if you are certain that all accounts at your IdP have verified email addresses.
Do **not** set this for public or consumer-facing IdPs where users control their own email
addresses.

### Rate limiting

The server does **not** rate-limit `/auth/oidc/*` internally — this is the operator's
responsibility at the edge:

- Put a rate limiter in front of `/auth/oidc/login` and `/auth/oidc/callback` at your reverse
  proxy (nginx, Caddy) or WAF layer.
- Limit by IP and by the `state` parameter to deter brute-force replay attempts.
- The authorization code is one-time-use (PKCE enforces this), but your edge controls
  how many attempts per second a client can make.

### Security properties

- Authorization Code + PKCE: the exchange is validated by `openid-client` (state, nonce, PKCE
  code verifier, id_token signature, iss, aud, exp).
- The callback redirect target is always the literal `/` — never a client-supplied URL parameter.
- The txn cookie (verifier + state + nonce) is cleared on every callback, success or error.
- User identity is keyed on `(iss, sub)` — not email — so an email change at the IdP does not
  create a second account.
