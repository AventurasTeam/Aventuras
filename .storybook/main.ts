// This file has been automatically migrated to valid ESM format by Storybook.
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from '@storybook/react-vite';
import path, { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config: StorybookConfig = {
  stories: [
    '../components/**/*.stories.@(ts|tsx|mdx)',
    '../app/**/*.stories.@(ts|tsx|mdx)',
  ],
  addons: ['@storybook/addon-a11y', '@storybook/addon-mcp', '@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(cfg) {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.alias = {
      ...(cfg.resolve.alias ?? {}),
      'react-native': 'react-native-web',
      '@': path.resolve(__dirname, '..'),
    };
    cfg.resolve.extensions = [
      '.web.tsx',
      '.web.ts',
      '.web.jsx',
      '.web.js',
      '.tsx',
      '.ts',
      '.jsx',
      '.js',
      '.json',
      '.mjs',
    ];
    cfg.define = {
      ...(cfg.define ?? {}),
      __DEV__: 'true',
      'process.env.EXPO_OS': JSON.stringify('web'),
    };
    // Expo's tsconfig sets `"jsx": "react-native"` (classic transform),
    // which esbuild would otherwise honor and leave JSX compiling to
    // React.createElement — forcing every story to `import React`.
    // Override to the automatic runtime for the Storybook build.
    cfg.esbuild = {
      ...(cfg.esbuild ?? {}),
      jsx: 'automatic',
    };
    // @rn-primitives/* ship JSX inside .mjs / .js files; teach Vite's
    // pre-bundler (esbuild) and runtime transformer to parse JSX from
    // .js files so they don't blow up the build.
    cfg.optimizeDeps = {
      ...(cfg.optimizeDeps ?? {}),
      include: [
        ...(cfg.optimizeDeps?.include ?? []),
        'react-native-web',
        '@rn-primitives/slot',
        '@rn-primitives/dialog',
      ],
      esbuildOptions: {
        ...(cfg.optimizeDeps?.esbuildOptions ?? {}),
        loader: {
          ...(cfg.optimizeDeps?.esbuildOptions?.loader ?? {}),
          '.js': 'jsx',
          '.mjs': 'jsx',
        },
      },
    };
    return cfg;
  },
};

export default config;
