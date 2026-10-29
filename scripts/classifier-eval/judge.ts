import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ClassifierExtraction } from '@/lib/classifier'

import type { EvalWindow } from './fixture'

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
 * Writes a faithfulness judge's input (judge-brief.md) into a new or empty `outDir` from probe runs
 * saved with PROBE_OUT: each window's Known lists and turns under turns/, as the prompt the runs
 * answered showed them, and each run's replies in a file under a label drawn at random, so the
 * judge can't tell runs apart by their order; key.txt names each label's run. A window a run has
 * no reply for is left out of that run's file.
 */
export function writeJudgeDump(
  windows: readonly EvalWindow[],
  runDirs: readonly string[],
  outDir: string,
): void {
  if (existsSync(outDir) && readdirSync(outDir).length > 0)
    throw new Error(`[judge] ${outDir} isn't empty, and a judge reads every run file in it`)
  // Every reply is read and described before anything is written, so a bad file leaves no partial
  // dump behind.
  const runs = runDirs.map((dir) => {
    const files = readdirSync(dir)
    const answered: EvalWindow[] = []
    const body: string[] = []
    for (const w of windows) {
      const numbered = files
        .flatMap((file) => {
          const n = new RegExp(`^${w.name}\\.(\\d+)\\.json$`).exec(file)?.[1]
          return n == null ? [] : [{ file, n: Number(n) }]
        })
        .sort((a, b) => a.n - b.n)
      if (numbered.length === 0) continue
      answered.push(w)
      body.push('', `## Window ${w.name}`)
      for (const { file, n } of numbered) {
        const reply = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ClassifierExtraction
        body.push('', `### Reply ${n}`, ...describeReply(reply))
      }
    }
    return { dir, answered, body }
  })
  const turns = windows.flatMap((w) => {
    const shown = new Set(
      runs
        .filter(({ answered }) => answered.includes(w))
        .map(({ dir }) => {
          const file = join(dir, `${w.name}.user.txt`)
          if (!existsSync(file))
            throw new Error(`[judge] ${dir} holds no ${w.name}.user.txt, the prompt it answered`)
          return readFileSync(file, 'utf8')
        }),
    )
    if (shown.size > 1)
      throw new Error(`[judge] the runs' prompts show ${w.name} differently; judge them apart`)
    return [...shown].map((user) => ({ name: w.name, user }))
  })

  mkdirSync(join(outDir, 'turns'), { recursive: true })
  for (const { name, user } of turns) writeFileSync(join(outDir, 'turns', `${name}.txt`), user)
  const shuffled = runs.map((run) => ({ run, sort: Math.random() })).sort((a, b) => a.sort - b.sort)
  const key: string[] = []
  shuffled.forEach(({ run }, i) => {
    const label = String.fromCharCode(65 + i)
    writeFileSync(
      join(outDir, `run-${label}.md`),
      `${[`# Run ${label}`, ...run.body].join('\n')}\n`,
    )
    key.push(`${label} ${run.dir}`)
  })
  writeFileSync(join(outDir, 'key.txt'), `${key.join('\n')}\n`)
}
