// Flat config. See:
//   https://docs.expo.dev/guides/using-eslint/
//   https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
//   https://github.com/prettier/eslint-config-prettier
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const storybook = require('eslint-plugin-storybook')
const prettierConfig = require('eslint-config-prettier/flat')

module.exports = defineConfig([
  expoConfig,
  ...storybook.configs['flat/recommended'],
  prettierConfig,
  {
    ignores: [
      'dist/**',
      'release/**',
      'storybook-static/**',
      'electron/dist/**',
      '.expo/**',
      'node_modules/**',
    ],
  },
])
