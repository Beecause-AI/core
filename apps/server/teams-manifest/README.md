# Teams App Package Template

This directory contains the Beecause Teams app manifest template.

## Token substitution

`manifest.json` contains the literal token `__BOT_ID__` in three fields (`id`, `bots[0].botId`, and `webApplicationInfo.id`). At download time, `GET /api/teams/manifest` (implemented in Task 8) replaces every occurrence of `__BOT_ID__` with the value of the `MICROSOFT_APP_ID` environment variable and streams a ZIP of this directory.

## Icons

| File | Size | Purpose |
|------|------|---------|
| `color.png` | 192×192 | Full-color icon shown in the Teams app catalog |
| `outline.png` | 32×32 | Outline icon used in the Teams sidebar (transparent background) |

> **Note:** The current `outline.png` is a resized version of the full-color mark. Per Teams guidelines it should be a monochrome/transparent glyph. A proper monochrome outline is a known follow-up (see `docs/teams-azure-setup-guide.html`).

## How to deploy

1. An org admin downloads the manifest ZIP via `GET /api/teams/manifest` (requires authentication).
2. In Microsoft Teams Admin Center → **Manage apps** → **Upload an app**, upload the downloaded ZIP.
3. After upload, Teams prompts the admin to install the app for their org.

For full setup instructions (Azure Bot registration, environment variables, etc.) see `docs/teams-azure-setup-guide.html`.
