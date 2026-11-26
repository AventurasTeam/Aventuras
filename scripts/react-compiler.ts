import { createRequire } from 'node:module'
import path from 'node:path'

import type { Plugin } from 'vite'

type Babel = {
  transformAsync: (
    source: string,
    options: Record<string, unknown>,
  ) => Promise<{ code?: string | null; map?: unknown } | null>
}

// Resolved through babel-preset-expo, the copy every Metro build runs, so tests compile
// with the shipped compiler rather than whatever version the root hoists.
const fromPreset = createRequire(createRequire(import.meta.url).resolve('babel-preset-expo'))

const SHIPPED = /^(app|components|hooks|lib)\//
const NOT_SHIPPED = /(\.test|\.stories)\.tsx?$|(^|\/)__tests__\//

/** True for a repo-relative path the app build runs React Compiler over. */
export function compiledInBuild(relativePath: string): boolean {
  return (
    SHIPPED.test(relativePath) && /\.tsx?$/.test(relativePath) && !NOT_SHIPPED.test(relativePath)
  )
}

/** The compiler as a babel plugin entry, with the build's options (babel-preset-expo). */
export function reactCompilerBabelPlugin(root: string): [string, Record<string, unknown>] {
  return [
    fromPreset.resolve('babel-plugin-react-compiler'),
    {
      target: '19',
      panicThreshold: 'none',
      sources: (filename: string) => compiledInBuild(path.relative(root, filename)),
    },
  ]
}

/**
 * Runs React Compiler over app sources before vite's own transform, so a hook whose
 * behaviour rests on the compiler's memoization is tested as it ships.
 */
export function reactCompilerVitePlugin(root: string): Plugin {
  const babel = fromPreset('@babel/core') as Babel
  const presetTypescript = fromPreset.resolve('@babel/preset-typescript')
  const compiler = reactCompilerBabelPlugin(root)
  return {
    name: 'react-compiler',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0]
      if (!compiledInBuild(path.relative(root, file))) return null
      // The compiler only touches components (JSX, so .tsx) and functions that call hooks.
      if (!file.endsWith('.tsx') && !/\buse[A-Z]\w*\s*\(/.test(code)) return null
      const result = await babel.transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        presets: [[presetTypescript, { isTSX: file.endsWith('.tsx'), allExtensions: true }]],
        plugins: [compiler],
      })
      return result?.code == null ? null : { code: result.code, map: result.map as never }
    },
  }
}
