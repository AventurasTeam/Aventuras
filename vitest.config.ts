import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  // react-native-web imports `react`; if vitest's dep optimizer bundles its
  // own copy, RNW's hooks hit a null React dispatcher. Dedupe keeps one copy.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
            // Visual-only stories that intentionally leave a Radix
            // dialog in submitting state and so leak body scroll-lock
            // across tests; loadable in Storybook UI, excluded here.
            tags: { exclude: ['no-vitest'] },
          }),
        ],
        optimizeDeps: { include: ['i18next', 'react-i18next'] },
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        extends: true,
        resolve: {
          // Aliases react-native to react-native-web so RN imports
          // (e.g. useColorScheme) parse cleanly under jsdom — RN's
          // entry has Flow annotations the bundler can't handle.
          alias: { 'react-native': 'react-native-web', '@': path.resolve(dirname, '.') },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts', 'components/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
