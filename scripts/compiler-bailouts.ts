import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import fg from 'fast-glob'

// React Compiler skips a component it can't trust and says nothing: builds run it at
// panicThreshold 'NONE'. This sweep runs the build's own compiler at 'all_errors', which turns
// each skip into an error, and ratchets the result against a checked-in baseline.
// docs/implementation/lessons-learned/exhaustive-deps-suppression-disables-the-compiler.md

type Babel = {
  transformAsync: (source: string, options: Record<string, unknown>) => Promise<unknown>
}

// Resolved through babel-preset-expo, which applies the compiler to every Metro build, so the
// sweep can't drift to whatever version the root happens to hoist.
const fromPreset = createRequire(createRequire(import.meta.url).resolve('babel-preset-expo'))
const babel = fromPreset('@babel/core') as Babel
const presetTypescript = fromPreset.resolve('@babel/preset-typescript')
const reactCompiler = fromPreset.resolve('babel-plugin-react-compiler')

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url).href)
const BASELINE = fileURLToPath(new URL('./compiler-bailouts.baseline.json', import.meta.url).href)

const SOURCES = ['app', 'components', 'hooks', 'lib'].map((dir) => `${dir}/**/*.{ts,tsx}`)
const IGNORE = ['**/*.stories.tsx', '**/*.test.{ts,tsx}', '**/__tests__/**', 'lib/db/migrations/**']

/** The compiler's first complaint about `source`, or null when it compiles every component. */
export async function compilerBailout(source: string, filename: string): Promise<string | null> {
  try {
    await babel.transformAsync(source, {
      filename,
      babelrc: false,
      configFile: false,
      // TSX only for .tsx: parsed as TSX, a .ts angle-bracket assertion `<T>value` is a syntax error.
      presets: [[presetTypescript, { isTSX: filename.endsWith('.tsx'), allExtensions: true }]],
      plugins: [[reactCompiler, { panicThreshold: 'all_errors' }]],
    })
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Past the "Found N errors:" header, the first line names the reason.
    const lines = message.split('\n').filter((line) => line.trim() !== '')
    return lines.find((line) => !/^Found \d+ errors?:/.test(line)) ?? message
  }
}

export function compareToBaseline(
  current: readonly string[],
  baseline: readonly string[],
): { added: string[]; fixed: string[] } {
  const now = new Set(current)
  const before = new Set(baseline)
  return {
    added: current.filter((file) => !before.has(file)).sort(),
    fixed: baseline.filter((file) => !now.has(file)).sort(),
  }
}

async function sweep(): Promise<Map<string, string>> {
  const files = await fg(SOURCES, { cwd: REPO_ROOT, ignore: IGNORE, absolute: true })
  const bailouts = new Map<string, string>()
  for (const file of files.sort()) {
    const reason = await compilerBailout(readFileSync(file, 'utf8'), file)
    if (reason != null) bailouts.set(relative(REPO_ROOT, file), reason)
  }
  return bailouts
}

async function main(): Promise<void> {
  const bailouts = await sweep()
  const current = [...bailouts.keys()]

  if (process.argv.includes('--list')) {
    for (const [file, reason] of bailouts) console.log(`${file}\n  ${reason}`)
    return
  }

  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
    console.log(`Baseline: ${current.length} files the compiler skips.`)
    return
  }

  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as string[]
  const { added, fixed } = compareToBaseline(current, baseline)
  for (const file of added) console.error(`new bail-out  ${file}\n  ${bailouts.get(file)}`)
  for (const file of fixed) console.error(`now compiles  ${file} — remove it from the baseline`)
  if (added.length > 0 || fixed.length > 0) {
    console.error(
      '\nFix the new bail-outs, or run `pnpm compiler:baseline` once they are deliberate.',
    )
    process.exit(1)
  }
  console.log(`React Compiler: ${current.length} known bail-outs, no new ones.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
