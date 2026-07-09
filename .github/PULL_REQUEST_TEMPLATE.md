## What and why

<!-- Describe the change and the problem it solves. Link any related issues (Fixes #123). -->

## How tested

<!-- How did you verify this works? Unit tests, integration tests, manual steps — list what you ran. -->

## Checklist

- [ ] `pnpm -r exec tsc --noEmit` passes (no type errors)
- [ ] `pnpm lint:boundaries` is clean (`packages/core` imports no cloud SDKs or app code)
- [ ] Tests added or updated for changed behaviour
- [ ] No secrets, API keys, or personal identifiers introduced

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution guide.
