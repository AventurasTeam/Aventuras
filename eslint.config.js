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

// generationStore's mutators live on an exported object, which the boundaries rule can't see (it
// reads imports, not property access). See docs/code-conventions.md → Syncing a store after a write.
const generationStoreMutators = (properties, message) =>
  properties.map((property) => ({ object: 'generationStore', property, message }))

// A stray caller can leave the hard gate or the reversal barrier stuck.
const RUN_MUTATORS = generationStoreMutators(
  [
    'startRun',
    'finishRun',
    'abortRun',
    'setReversalInProgress',
    'setCurrentPhase',
    'recordPhaseResult',
  ],
  'Only the orchestrator and the prose-reversal bracket drive a run. See docs/code-conventions.md → Syncing a store after a write.',
)

// A stray write makes the next Send start a close nobody owes, or skip one that is owed.
const CLOSE_RECORD_MUTATORS = generationStoreMutators(
  ['setPendingClose', 'clearPendingClose', 'clearDeferredClose', 'dropBranchRecords'],
  "Only a close's record writers write pendingClose or deferred, and prose reversal may clearPendingClose. See docs/generation-pipeline.md → Multi-run txState.",
)

const CLOSE_PROGRESS_MUTATORS = generationStoreMutators(
  ['setCloseProgress'],
  "Only the orchestrator sets a close's progress. See docs/implementation/milestones/05-chapters-chapter-close/milestone.md#c6--what-the-banners-n-of-m-counts.",
)

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
        // RN's default "never" spends the first tap while a field is focused on dismissing the
        // keyboard. Kept in this array: a second no-restricted-syntax entry would replace it.
        {
          selector:
            'JSXOpeningElement[name.name=/^(GH)?(ScrollView|FlatList|SectionList)$|^BottomSheet(ScrollView|FlatList|SectionList)$|^KeyboardAwareScrollView$/]:not(:has(> JSXAttribute[name.name="keyboardShouldPersistTaps"])):not(:has(> JSXSpreadAttribute))',
          message:
            'Set keyboardShouldPersistTaps (usually "handled"): the default spends the first tap on dismissing the keyboard. See docs/ui/foundations/mobile/touch.md.',
        },
        {
          selector:
            'JSXOpeningElement[name.property.name=/^(ScrollView|FlatList|SectionList)$/]:not(:has(> JSXAttribute[name.name="keyboardShouldPersistTaps"])):not(:has(> JSXSpreadAttribute))',
          message:
            'Set keyboardShouldPersistTaps (usually "handled"): the default spends the first tap on dismissing the keyboard. See docs/ui/foundations/mobile/touch.md.',
        },
      ],

      // generationStore's mutators, by owner: see the constants at the top of this file.
      'no-restricted-properties': [
        'error',
        ...RUN_MUTATORS,
        ...CLOSE_RECORD_MUTATORS,
        ...CLOSE_PROGRESS_MUTATORS,
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
            // lib/actions/index.ts re-exports run-now, which imports the lib/pipeline barrel; a value
            // import back closes that cycle, and a mocked pipeline barrel then resolves to the real one.
            {
              from: [{ type: 'lib-module', captured: { name: 'pipeline' } }],
              disallow: [
                {
                  to: {
                    type: 'lib-module',
                    captured: { name: 'actions' },
                    internalPath: 'index.ts',
                  },
                  dependency: { kind: 'value' },
                },
              ],
              message:
                'lib/pipeline takes no value import of the lib/actions barrel: it imports @/lib/pipeline back, a cycle. Read from lib/db, or import types from @/lib/actions/types.',
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
            // lib/*.ts files are a separate element, so naming lib-module alone would let
            // @/lib/keyword-terms through; app-code covers hooks/ and constants/.
            {
              from: [{ type: 'lib-module', captured: { name: 'tokens' } }],
              disallow: [
                { to: [{ type: 'lib-module' }, { type: 'lib-file' }, { type: 'app-code' }] },
              ],
              message:
                'lib/tokens is a leaf: the seed imports it on the boot path, and a value cycle there fails only on Android. See docs/implementation/milestones/05-chapters-chapter-close/milestone.md#c5--token-reads-and-the-progress-hook.',
            },
            // Stores, actions, retrieval and the progress hook all bring lib/db in at runtime, so
            // banning lib/db alone wouldn't hold. lib-file stays open for @/lib/keyword-terms.
            {
              from: [{ type: 'lib-module', captured: { name: 'chapters' } }],
              disallow: [
                {
                  to: [{ type: 'lib-module' }, { type: 'app-code' }],
                  dependency: { kind: 'value' },
                },
              ],
              message:
                'lib/chapters takes no value import of a lib module or app code, which can bring lib/db in at runtime: it holds pure rules, and the seed and DOM reader code reach it. See docs/implementation/milestones/05-chapters-chapter-close/milestone.md#c5--token-reads-and-the-progress-hook.',
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

  // A close's record writers. The one other record write is prose reversal's clearPendingClose.
  // Owner blocks sit before the off-block, so their files' tests stay exempt.
  {
    files: [
      'lib/actions/chapters/**',
      'lib/actions/stories/delete-story.ts',
      'lib/pipeline/definitions/chapter-close-boundary.ts',
      'lib/pipeline/definitions/memory-chain.ts',
    ],
    rules: {
      'no-restricted-properties': ['error', ...RUN_MUTATORS, ...CLOSE_PROGRESS_MUTATORS],
    },
  },

  // The orchestrator drives a run and sets a close's progress, but writes no close record.
  {
    files: ['lib/pipeline/runtime/**'],
    rules: {
      'no-restricted-properties': ['error', ...CLOSE_RECORD_MUTATORS],
    },
  },

  // Prose reversal's bracket drives its run and drops a pick whose end entry the reversal removed.
  {
    files: ['lib/actions/story-entries/prose-reversal.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...CLOSE_RECORD_MUTATORS.filter(({ property }) => property !== 'clearPendingClose'),
        ...CLOSE_PROGRESS_MUTATORS,
      ],
    },
  },

  // Tests and story fixtures stage a run in progress.
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**', '**/*.stories.tsx'],
    rules: {
      'no-restricted-properties': 'off',
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
      // Orca and agent-isolation worktrees: whole repo copies inside this checkout.
      '.worktrees/**',
      '.claude/worktrees/**',
      'lib/db/migrations/**',
    ],
  },
])
