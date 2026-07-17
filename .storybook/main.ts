import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-native-web-vite'

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  stories: [
    '../components/**/*.mdx',
    '../components/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    '../app/**/*.stories.@(js|jsx|mjs|ts|tsx)',
  ],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-mcp',
  ],
  framework: {
    name: '@storybook/react-native-web-vite',
    options: {
      pluginReactOptions: {
        jsxImportSource: 'nativewind',
      },
    },
  },
  async viteFinal(viteConfig) {
    const existingAlias = viteConfig.resolve?.alias
    // Vite's AliasOptions allows either an array of {find, replacement} or a
    // plain object map — normalize the object form instead of discarding it,
    // so a future preset/config that sets alias as an object doesn't silently
    // lose its entries here.
    const existingAliasEntries = Array.isArray(existingAlias)
      ? existingAlias
      : existingAlias
        ? Object.entries(existingAlias).map(([find, replacement]) => ({ find, replacement }))
        : []
    viteConfig.resolve ??= {}
    viteConfig.resolve.alias = [
      ...existingAliasEntries,
      // lib/markdown/sanitize.ts's Node/SSG-only jsdom fallback is dead code
      // in Storybook (window always exists there) — Vite's dep pre-bundler
      // doesn't know that and pulls jsdom in anyway, crashing on
      // SharedArrayBuffer. Stub it out; see jsdom-stub.ts for the full story.
      { find: 'jsdom', replacement: path.resolve(dirname, 'jsdom-stub.ts') },
    ]
    return viteConfig
  },
}
export default config
