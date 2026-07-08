#!/usr/bin/env node
// One-time helper to register the "IntelliLabs Agent" GitHub App via the
// GitHub App Manifest flow. GitHub auto-generates the private key, webhook
// secret, and client credentials — no manual field entry.
//
// Usage:
//   node scripts/github-app/create-app.mjs                 # owned by the wisely-solutions org
//   GH_ORG=<other-org> node scripts/github-app/create-app.mjs
//   PORT=4567 ... (override the local callback port)
//
// The App is owned by a GitHub org (default: wisely-solutions), never a personal account.
//
// ⚠️  Make sure your BROWSER is logged into the correct IntelliLabs GitHub
//     account and can admin the org — NOT the IKEA work account.
//
// This is a throwaway setup tool, not part of the product. Delete it after use.

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 4567)
const GH_ORG = process.env.GH_ORG || 'wisely-solutions' // org-owned; override with GH_ORG
const OUT_DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE = crypto.randomBytes(12).toString('hex')

// Everything GitHub needs to create the App, pre-filled per the spec (§7.4, §10).
const manifest = {
  name: 'IntelliLabs Agent',
  url: 'https://intellilabs.dev',
  hook_attributes: { url: 'https://webhooks.intellilabs.dev/api/github', active: true },
  redirect_url: `http://localhost:${PORT}/callback`, // receives the conversion code
  setup_url: 'https://connect.intellilabs.dev/api/github/setup',
  setup_on_update: true,
  public: true,
  default_permissions: {
    contents: 'write',
    metadata: 'read',
    issues: 'write',
    pull_requests: 'write',
  },
  default_events: [
    'push',
    'create',
    'delete',
    'issues',
    'issue_comment',
    'pull_request',
    'pull_request_review',
    'pull_request_review_comment',
  ],
}

const newAppUrl = `https://github.com/organizations/${GH_ORG}/settings/apps/new?state=${STATE}`

const formPage = `<!doctype html><html><head><meta charset="utf-8"><title>Create IntelliLabs Agent</title>
<style>body{font:15px system-ui;margin:48px auto;max-width:560px;color:#1d1d20}
.warn{background:#fff8ec;border:1px solid #f3e0bd;border-radius:8px;padding:12px 14px;color:#7a5a00}
button{font:600 15px system-ui;background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:11px 18px;cursor:pointer}
code{background:#f1f1f4;padding:1px 5px;border-radius:4px}</style></head><body>
<h2>Create the “IntelliLabs Agent” GitHub App</h2>
<p class="warn">⚠️ Confirm your browser is signed into the correct <b>IntelliLabs</b> GitHub account
and that you can admin the <code>${GH_ORG}</code> org — <b>not</b> the IKEA work account.</p>
<p>Clicking below sends a pre-filled manifest to GitHub. You'll review the App on GitHub and click
<b>Create GitHub App</b>; GitHub then returns here with the generated credentials.</p>
<form method="post" action="${newAppUrl}">
  <input type="hidden" name="manifest" value='${JSON.stringify(manifest).replace(/'/g, '&#39;')}'>
  <button type="submit">Review &amp; create on GitHub →</button>
</form>
</body></html>`

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`)

  if (u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(formPage)
    return
  }

  if (u.pathname === '/callback') {
    const code = u.searchParams.get('code')
    const state = u.searchParams.get('state')
    if (!code) {
      res.writeHead(400, { 'content-type': 'text/html' }).end('<p>Missing <code>code</code>. Start again at /.</p>')
      return
    }
    if (state !== STATE) {
      res.writeHead(400, { 'content-type': 'text/html' }).end('<p>State mismatch — possible CSRF. Aborting.</p>')
      return
    }
    try {
      const resp = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'intellilabs-app-setup' },
      })
      if (!resp.ok) throw new Error(`conversion failed: ${resp.status} ${await resp.text()}`)
      const app = await resp.json()

      const pemPath = path.join(OUT_DIR, 'intellilabs-agent.private-key.pem')
      fs.writeFileSync(pemPath, app.pem, { mode: 0o600 })

      const creds = {
        app_id: app.id,
        slug: app.slug,
        html_url: app.html_url,
        client_id: app.client_id,
        client_secret: app.client_secret,
        webhook_secret: app.webhook_secret,
        pem_file: pemPath,
      }
      fs.writeFileSync(path.join(OUT_DIR, '.app-credentials.json'), JSON.stringify(creds, null, 2), { mode: 0o600 })

      res.writeHead(200, { 'content-type': 'text/html' }).end(
        `<body style="font:15px system-ui;margin:48px auto;max-width:620px">
        <h2>✅ App created: ${app.slug}</h2>
        <p>Mention handle: <code>@${app.slug}</code> · <a href="${app.html_url}">${app.html_url}</a></p>
        <p>Credentials saved to <code>scripts/github-app/.app-credentials.json</code> and the private key to
        <code>scripts/github-app/intellilabs-agent.private-key.pem</code>. <b>Keep these secret.</b></p>
        <p>Return to your terminal for the next steps. You can close this tab.</p></body>`
      )

      console.log('\n✅ GitHub App created:', app.slug)
      console.log('   App ID:        ', app.id)
      console.log('   Client ID:     ', app.client_id)
      console.log('   PEM:           ', pemPath)
      console.log('   Webhook secret: (saved in .app-credentials.json)')
      console.log('\nNext: load these into the server config / Pulumi secrets per spec §10 as:')
      console.log('   GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY (the PEM contents),')
      console.log('   GITHUB_APP_WEBHOOK_SECRET, and (if used) the client id/secret.')
      console.log('   Also generate/keep an INTEGRATION_STATE_SECRET (HMAC key) separately.')
      if (app.slug !== 'intellilabs-agent') {
        console.log(`\n⚠️  Slug is "${app.slug}", not "intellilabs-agent" — the mention handle will be @${app.slug}.`)
        console.log('   Rename the App on GitHub if you need the exact handle.')
      }
      console.log('\nDone. You can stop this script (Ctrl+C) and delete scripts/github-app/ when finished.')
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/html' }).end(`<pre>${String(err)}</pre>`)
      console.error(err)
    }
    return
  }

  res.writeHead(404).end('not found')
})

server.listen(PORT, () => {
  console.log('IntelliLabs Agent — GitHub App creator')
  console.log(`Owner: org "${GH_ORG}"`)
  console.log(`\n👉 Open  http://localhost:${PORT}  in a browser signed into the correct GitHub account.\n`)
})
