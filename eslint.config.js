import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import unusedImports from 'eslint-plugin-unused-imports'
import boundaries from 'eslint-plugin-boundaries'

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
    },
    settings: {
      'boundaries/elements': [
        { type: 'service', pattern: 'src/lib/services/*', mode: 'folder' },
        { type: 'store', pattern: 'src/lib/stores', mode: 'folder' },
        { type: 'component', pattern: 'src/lib/components', mode: 'folder' },
        { type: 'route', pattern: 'src/routes', mode: 'folder' },
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
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/no-at-html-tags': 'off',
      'svelte/prefer-svelte-reactivity': 'off',
      'boundaries/dependencies': [
        'warn',
        {
          default: 'allow',
          rules: [
            {
              to: ['service'],
              disallow: {
                to: { internalPath: '!index.ts' },
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
