import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'

export default defineConfig({
  test: {
    projects: [
      {
        // Existing unit tests — keep current store aliasing behavior
        extends: false,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/test/e2e/**'],
          environment: 'node',
        },
        resolve: {
          alias: [
            { find: /^@tauri-apps\/.*/, replacement: path.resolve('./src/test/tauri-stub.ts') },
            { find: /^\$lib\/stores\/.*/, replacement: path.resolve('./src/test/stores-stub.ts') },
            { find: '$lib', replacement: path.resolve('./src/lib') },
            { find: '$test', replacement: path.resolve('./src/test') },
          ],
        },
      },
      {
        // E2E tests — real stores, Svelte rune transforms enabled
        extends: false,
        plugins: [svelte({ hot: false })],
        test: {
          name: 'e2e',
          include: ['src/test/e2e/**/*.test.ts'],
          environment: 'node',
        },
        resolve: {
          alias: [
            { find: /^@tauri-apps\/.*/, replacement: path.resolve('./src/test/tauri-stub.ts') },
            // NO $lib/stores alias — imports resolve to real store files
            { find: '$lib', replacement: path.resolve('./src/lib') },
            { find: '$test', replacement: path.resolve('./src/test') },
          ],
        },
      },
    ],
  },
})
