// Flat config. See:
//   https://docs.expo.dev/guides/using-eslint/
//   https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
//   https://github.com/prettier/eslint-config-prettier
//
// Project rule policy is documented in .claude/rules/code.md. The
// wildcard-import ban is mechanically enforced here AND explained
// there; the rn-primitives exception list must stay in sync between
// the two files.
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const storybook = require('eslint-plugin-storybook')
const prettierConfig = require('eslint-config-prettier/flat')
const reactNative = require('eslint-plugin-react-native')
const unusedImports = require('eslint-plugin-unused-imports')
const tseslint = require('@typescript-eslint/eslint-plugin')
const boundaries = require('eslint-plugin-boundaries')

module.exports = defineConfig([
  expoConfig,
  ...storybook.configs['flat/recommended'],
  prettierConfig,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-native': reactNative,
      'unused-imports': unusedImports,
      '@typescript-eslint': tseslint,
      boundaries,
    },
    settings: {
      // boundaries resolves imports through this resolver so `@/` aliases
      // (tsconfig maps `@/* → ./*`) and bare-directory imports resolve to
      // the module's index.ts.
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
      // `lib-module` is folder-mode so a module's files share one element
      // and intra-module relative imports count as internal (not checked).
      // The catch-all excludes `lib/` (`!(lib)/**`) so it never competes
      // with lib-module for lib files; it exists only to make every source
      // file OUTSIDE lib a known element — required because the
      // dependencies rule skips imports originating from unknown files, so
      // without it imports from outside lib/ would not be checked at all.
      'boundaries/elements': [
        { type: 'lib-module', pattern: 'lib/*', mode: 'folder', capture: ['name'] },
        { type: 'lib-file', pattern: 'lib/*.ts', mode: 'file' },
        { type: 'app-code', pattern: '!(lib)/**', mode: 'full' },
      ],
    },
    rules: {
      // Wildcard import ban. Exception list lives in
      // .claude/rules/code.md — keep in sync.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration[source.value!=/^@rn-primitives\\//] ImportNamespaceSpecifier',
          message:
            'Wildcard imports are banned. Use named imports. Exception: @rn-primitives/*. See .claude/rules/code.md.',
        },
      ],

      // lib/* modules expose a public API via index.ts; any importer
      // outside the module (incl. outside lib/) must import the bare module
      // path, never a deep internal file. See docs/code-conventions.md.
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          rules: [
            // Disallow deep imports for everything except from pipeline to actions/types.ts to avoid circular require warnings in Metro/Expo
            {
              from: [
                { type: 'app-code' },
                { type: 'lib-file' },
                { type: 'lib-module', captured: { name: '!pipeline' } },
              ],
              disallow: [{ to: { type: 'lib-module', internalPath: '!index.ts' } }],
              message:
                'Import a lib module through its public API (index.ts), not its internal files. See docs/code-conventions.md.',
            },
            {
              from: [{ type: 'lib-module', captured: { name: 'pipeline' } }],
              disallow: [{ to: { type: 'lib-module', internalPath: '!{index.ts,types.ts}' } }],
              message:
                'Import a lib module through its public API (index.ts) or types.ts, not its internal files. See docs/code-conventions.md.',
            },
            // lib/diagnostics is zero-dependency infrastructure; importing
            // lib/stores would invert the layering and close an import cycle
            // (the gate is injected, not imported). See
            // docs/observability.md#store-ownership-and-gate-wiring.
            {
              from: [{ type: 'lib-module', captured: { name: 'diagnostics' } }],
              disallow: [{ to: [{ type: 'lib-module', captured: { name: 'stores' } }] }],
              message:
                'lib/diagnostics must not import lib/stores — the diagnostics gate is injected via configureDiagnosticsGate, never imported. See docs/observability.md#store-ownership-and-gate-wiring.',
            },
          ],
        },
      ],

      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // unused-imports replaces @typescript-eslint/no-unused-vars so
      // dead imports get auto-removed (the TS rule warns but won't fix
      // imports).
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'none',
          ignoreRestSiblings: true,
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      'react-hooks/exhaustive-deps': 'error',

      // Direct console.* bypasses the diagnostics gate and never lands in the
      // logEntries slice. Route through `logger` instead. Off inside
      // lib/diagnostics (the mirror lives there) and in dev-only paths below.
      'no-console': 'error',

      'react-native/no-inline-styles': 'error',
      'react-native/no-color-literals': 'error',
    },
  },

  // Story files, dev routes, and Storybook-docs surfaces routinely
  // need ad-hoc inline styling for demos.
  {
    files: ['**/*.stories.tsx', 'app/dev/**', 'components/foundations/**'],
    rules: {
      'react-native/no-inline-styles': 'off',
      'react-native/no-color-literals': 'off',
    },
  },

  // Console is fine in build scripts, dev routes, the Electron main process
  // (no other diagnostic surface), story action handlers, and the logger
  // module itself (it owns console mirroring + the dev drift warning).
  {
    files: ['scripts/**', 'app/dev/**', 'electron/**', '**/*.stories.tsx', 'lib/diagnostics/**'],
    rules: {
      'no-console': 'off',
    },
  },

  // Build scripts run under tsx (Node) and legitimately reach into lib
  // module internals for data/logic; they can't import the React-coupled
  // public barrels. Exempt from the lib public-API rule. See
  // docs/code-conventions.md.
  {
    files: ['scripts/**/*.{ts,tsx}'],
    rules: {
      'boundaries/dependencies': 'off',
    },
  },

  // Tests + shared test fixtures legitimately reach across module internals
  // (e.g. the in-memory test db). Public-API enforcement for shipped code is
  // unaffected; the boundaries rule is still asserted via eslint.lintText on
  // non-test fixture paths. See docs/code-conventions.md.
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**', 'vitest.setup.ts'],
    rules: {
      'boundaries/dependencies': 'off',
    },
  },

  {
    ignores: [
      'dist/**',
      'release/**',
      'storybook-static/**',
      'electron/dist/**',
      '.expo/**',
      'node_modules/**',
      '_tmp/**',
      'lib/db/migrations/**',
    ],
  },
])
