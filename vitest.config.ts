import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@tauri-apps\/.*/,
        replacement: path.resolve('./src/test/tauri-stub.ts'),
      },
      {
        find: /^\$lib\/stores\/.*/,
        replacement: path.resolve('./src/test/stores-stub.ts'),
      },
      {
        find: '$lib',
        replacement: path.resolve('./src/lib'),
      },
    ],
  },
  test: {
    environment: 'node',
  },
})
