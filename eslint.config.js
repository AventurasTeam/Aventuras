import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import unusedImports from 'eslint-plugin-unused-imports'
import boundaries from 'eslint-plugin-boundaries'
import fs from 'node:fs'
import path from 'node:path'

const libRoot = path.join(import.meta.dirname, 'src/lib')
function isExactFile(rest, dirListings) {
  let dir = libRoot
  for (const segment of rest.split('/')) {
    if (!dirListings.has(dir)) {
      dirListings.set(dir, fs.existsSync(dir) ? new Set(fs.readdirSync(dir)) : new Set())
    }
    if (!dirListings.get(dir).has(segment)) return false
    dir = path.join(dir, segment)
  }
  return fs.statSync(dir, { throwIfNoEntry: false })?.isFile() ?? false
}

const viModuleCalls = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
])

const localPlugin = {
  rules: {
    'no-self-keyed-each': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          selfKeyed: 'Key by a stable id, or by index when items hold no state.',
        },
      },
      create(context) {
        return {
          SvelteEachBlock(node) {
            const { context: item, key } = node
            if (
              item?.type === 'Identifier' &&
              key?.type === 'Identifier' &&
              item.name === key.name
            ) {
              context.report({ node: key, messageId: 'selfKeyed' })
            }
          },
        }
      },
    },
    // Why TypeScript is not enough: docs/architecture/overview.md, "Importing src/lib".
    'lib-import-exists': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          useHashLib: "Import src/lib as '#lib/…' with the file's real extension.",
          missing:
            "'{{specifier}}' is not a file under src/lib. Use its real extension (.ts, .svelte.ts, /index.ts).",
        },
      },
      create(context) {
        // Per file, so an editor's long-lived ESLint sees files created since it started.
        const dirListings = new Map()
        function check(source) {
          if (source?.type !== 'Literal' || typeof source.value !== 'string') return
          const specifier = source.value
          if (specifier === '$lib' || specifier.startsWith('$lib/')) {
            context.report({ node: source, messageId: 'useHashLib' })
          } else if (
            specifier.startsWith('#lib') &&
            !(specifier.startsWith('#lib/') && isExactFile(specifier.slice(5), dirListings))
          ) {
            context.report({ node: source, messageId: 'missing', data: { specifier } })
          }
        }
        return {
          ImportDeclaration: (node) => check(node.source),
          ExportNamedDeclaration: (node) => check(node.source),
          ExportAllDeclaration: (node) => check(node.source),
          ImportExpression: (node) => check(node.source),
          CallExpression(node) {
            const { callee } = node
            if (
              callee.type === 'MemberExpression' &&
              callee.object.type === 'Identifier' &&
              callee.object.name === 'vi' &&
              callee.property.type === 'Identifier' &&
              viModuleCalls.has(callee.property.name)
            ) {
              check(node.arguments[0])
            }
          },
        }
      },
    },
  },
}

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['**/*.svelte.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte'],
    rules: { 'local/no-self-keyed-each': 'error' },
  },
  {
    ignores: [
      'build/',
      '.svelte-kit/',
      'dist/',
      'node_modules/',
      'src-tauri/',
      '.release-pre3-check/',
    ],
  },
  {
    plugins: {
      'unused-imports': unusedImports,
      prettier: eslintPluginPrettier,
      boundaries,
      local: localPlugin,
    },
    settings: {
      'boundaries/elements': [
        { type: 'service', pattern: 'src/lib/services/*' },
        { type: 'store', pattern: 'src/lib/stores' },
        { type: 'component', pattern: 'src/lib/components' },
        { type: 'route', pattern: 'src/routes' },
      ],
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'unused-imports/no-unused-imports': 'error',
      'prettier/prettier': 'error',
      'local/lib-import-exists': 'error',
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/no-at-html-tags': 'off',
      'boundaries/dependencies': [
        'warn',
        {
          default: 'allow',
          // v7 renamed `rules` to `policies`; the element type belongs in the `disallow`
          // target rather than in a second outer `to`.
          policies: [
            {
              disallow: {
                to: { element: { type: 'service', fileInternalPath: '!index.ts' } },
              },
              message:
                'Import from the service public API (index.ts), not internal modules. Use relative imports within the same service.',
            },
          ],
        },
      ],
    },
  },
]
