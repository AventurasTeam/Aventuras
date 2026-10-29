import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ClassifierExtraction } from '@/lib/classifier'
import { APP_SETTINGS_DEFAULTS } from '@/lib/db'

import type { EvalWindow } from './fixture'
import { renderWindow } from './render'

/** A reply's happenings and new characters, one line each: what the judge reads against the turns. */
export function describeReply(reply: ClassifierExtraction): string[] {
  return [
    ...reply.happenings.map((h) => {
      const when = [h.sourceTurn, h.temporal].filter((s) => s != null && s !== '').join(', ')
      return `- happening [${when}] ${h.title}: ${h.description ?? '(no description)'}`
    }),
    ...reply.newCharacters.map(
      (c) => `- new character ${c.name === '' ? '(blank)' : c.name}: ${c.description}`,
    ),
  ]
}

/**
 * Writes a faithfulness judge's input (judge-brief.md) from probe runs saved with PROBE_OUT: each
 * window's Known lists and turns under turns/, and each run's replies in a file under a label
 * drawn at random, so the judge can't tell runs apart by their order; key.txt names each label's
 * run. A window a run has no reply for is left out of that run's file.
 */
export function writeJudgeDump(
  windows: readonly EvalWindow[],
  runDirs: readonly string[],
  outDir: string,
): void {
  mkdirSync(join(outDir, 'turns'), { recursive: true })
  for (const w of windows) {
    const { prompt } = renderWindow(w, APP_SETTINGS_DEFAULTS.classifierWindowMaxEntries)
    writeFileSync(join(outDir, 'turns', `${w.name}.txt`), `${prompt.user}\n`)
  }
  const shuffled = runDirs
    .map((dir) => ({ dir, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
  const key: string[] = []
  shuffled.forEach(({ dir }, i) => {
    const label = String.fromCharCode(65 + i)
    const lines = [`# Run ${label}`]
    const files = readdirSync(dir)
    for (const w of windows) {
      const runs = files
        .map((f) => new RegExp(`^${w.name}\\.(\\d+)\\.json$`).exec(f)?.[1])
        .filter((n) => n != null)
        .map(Number)
        .sort((a, b) => a - b)
      if (runs.length === 0) continue
      lines.push('', `## Window ${w.name}`)
      for (const run of runs) {
        const reply = JSON.parse(
          readFileSync(join(dir, `${w.name}.${run}.json`), 'utf8'),
        ) as ClassifierExtraction
        lines.push('', `### Reply ${run}`, ...describeReply(reply))
      }
    }
    writeFileSync(join(outDir, `run-${label}.md`), `${lines.join('\n')}\n`)
    key.push(`${label} ${dir}`)
  })
  writeFileSync(join(outDir, 'key.txt'), `${key.join('\n')}\n`)
}
