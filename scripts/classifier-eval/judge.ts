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
  const runs = runDirs.map((dir) => {
    const files = readdirSync(dir)
    const replies = windows.map((w) => ({
      w,
      numbers: files
        .map((f) => new RegExp(`^${w.name}\\.(\\d+)\\.json$`).exec(f)?.[1])
        .filter((n) => n != null)
        .map(Number)
        .sort((a, b) => a - b),
    }))
    return { dir, replies: replies.filter(({ numbers }) => numbers.length > 0) }
  })
  const turns = windows.flatMap((w) => {
    const shown = new Set(
      runs
        .filter(({ replies }) => replies.some((r) => r.w === w))
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
    const lines = [`# Run ${label}`]
    for (const { w, numbers } of run.replies) {
      lines.push('', `## Window ${w.name}`)
      for (const n of numbers) {
        const reply = JSON.parse(
          readFileSync(join(run.dir, `${w.name}.${n}.json`), 'utf8'),
        ) as ClassifierExtraction
        lines.push('', `### Reply ${n}`, ...describeReply(reply))
      }
    }
    writeFileSync(join(outDir, `run-${label}.md`), `${lines.join('\n')}\n`)
    key.push(`${label} ${run.dir}`)
  })
  writeFileSync(join(outDir, 'key.txt'), `${key.join('\n')}\n`)
}
