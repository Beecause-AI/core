/**
 * Hexagonal boundary rules (OSS refactor). SCOPE IS INTENTIONALLY packages/core TODAY —
 * every port/adapter currently lives there (physical package split is deferred to a later plan).
 *
 * WHEN A LATER PLAN ADDS PORTS/ADAPTERS IN ANOTHER PACKAGE, extend enforcement or they
 * silently escape it:
 *   - A plan that adds ports/adapters in packages/engine (e.g. the embeddings adapter) →
 *     add `packages/engine` to the `depcruise` CLI target (package.json `lint:boundaries`),
 *     reference its tsconfig, and add engine-scoped copies of the `from.path` anchors below.
 *   - The package-split plan (ports → packages/domain, adapters → packages/adapters/*) →
 *     widen the CLI target to `packages` and generalize the `^packages/core/src/ports/` and
 *     `^packages/core/testing/port-contracts/` anchors to the new cross-package locations.
 *   - Each new adapter that imports a cloud SDK must add that SDK to the `ports-are-pure` deny-list.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'ports-are-pure',
      comment:
        'Hexagonal dependency rule: domain ports must not import cloud SDKs or concrete adapters.',
      severity: 'error',
      from: { path: '^packages/core/src/ports/' },
      to: {
        path: [
          '^packages/core/src/adapters/',
          'node_modules/(@google-cloud|google-auth-library|@aws-sdk|@azure|pg|drizzle-orm)/',
        ],
      },
    },
    {
      name: 'contracts-are-adapter-free',
      comment: 'Port contract suites test against injected adapters; they must not import one directly.',
      severity: 'error',
      from: { path: '^packages/core/testing/port-contracts/' },
      to: { path: '^packages/core/src/adapters/' },
    },
    {
      name: 'core-engine-no-billing',
      comment: 'OSS core and engine must not import the proprietary billing package.',
      severity: 'error',
      from: { path: '^packages/(core|engine)/src' },
      to: { path: '^(packages/billing/(src)?|@intellilabs/billing)' },
    },
  ],
  options: {
    tsConfig: { fileName: require('path').resolve(__dirname, 'packages/core/tsconfig.json') },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    moduleSystems: ['es6', 'cjs'],
  },
};
