import { and, desc, eq, ne } from 'drizzle-orm'
import { describe, it } from 'vitest'

import { branches, deltas, stories, type Delta } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { median } from './fixture'

// Cost harness, not a test — it asserts nothing. Run with `pnpm bench:undo` when a change moves
// what CTRL-Z reads (lib/actions/story-entries/undo.ts) or how a reversal finds its action's rows
// (lib/actions/delta/reverse-replay.ts). Times the node:sqlite connection the desktop main process
// runs; the renderer's IPC hop on top of it is not measured.

type Scenario = { label: string; deltas: number }

// The dataset chapter's branch holds 1,017 deltas in 88 groups, about 465 bytes of row each; the
// long-branch scales (2,654 and 7,934 entries) at its 7.6 deltas an entry give the other two.
const SCENARIOS: Scenario[] = [
  { label: 'dataset chapter: 1,017 deltas', deltas: 1_017 },
  { label: 'long branch, 2,654 entries: ~20k deltas', deltas: 20_000 },
  { label: 'long branch, 7,934 entries: ~60k deltas', deltas: 60_000 },
]

const BRANCH = 'b1'
const GROUP = 12
const RUNS = 7
const PAYLOAD_TEXT = 'The rain kept on through the night, and the lamps along the quay burned low. '

async function seed(scenario: Scenario) {
  const { db, sqlite } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 's1', name: 'main', createdAt: 1 })
  const rows = Array.from({ length: scenario.deltas }, (_, i) => ({
    id: `delta_${i}`,
    branchId: BRANCH,
    entryId: `entry_${Math.floor(i / GROUP)}`,
    actionId: `act_${Math.floor(i / GROUP)}`,
    logPosition: i + 1,
    source: 'per_turn_classifier' as const,
    targetTable: 'entities',
    targetId: `char_${i % 300}`,
    op: 'update' as const,
    undoPayload: { description: PAYLOAD_TEXT.repeat(4), status: 'active' },
    createdAt: i,
  }))
  for (let i = 0; i < rows.length; i += 100) await db.insert(deltas).values(rows.slice(i, i + 100))
  return { db, sqlite }
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const samples: number[] = []
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now()
    await fn()
    samples.push(performance.now() - start)
  }
  return median(samples)
}

describe('undo cost', () => {
  for (const scenario of SCENARIOS) {
    it(
      scenario.label,
      async () => {
        const { db, sqlite } = await seed(scenario)
        const headAction = `act_${Math.floor((scenario.deltas - 1) / GROUP)}`
        const wholeLog = await timed(() =>
          db
            .select()
            .from(deltas)
            .where(eq(deltas.branchId, BRANCH))
            .orderBy(desc(deltas.logPosition)),
        )
        // The shape undo.ts reads: the head row a user would undo, then its action's rows.
        const headGroup = await timed(async () => {
          const [head] = await db
            .select({ actionId: deltas.actionId })
            .from(deltas)
            .where(and(eq(deltas.branchId, BRANCH), ne(deltas.source, 'periodic_classifier')))
            .orderBy(desc(deltas.logPosition))
            .limit(1)
          return db
            .select()
            .from(deltas)
            .where(and(eq(deltas.branchId, BRANCH), eq(deltas.actionId, head!.actionId)))
            .orderBy(desc(deltas.logPosition))
        })
        const byAction = await timed(() =>
          db.select().from(deltas).where(eq(deltas.actionId, headAction)),
        )
        const plan = sqlite
          .prepare('EXPLAIN QUERY PLAN SELECT * FROM deltas WHERE action_id = ?')
          .all(headAction)
          .map((row) => (row as { detail: string }).detail)
          .join('; ')
        const rows = (await db.select().from(deltas).where(eq(deltas.branchId, BRANCH))) as Delta[]
        const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0)
        const lines = [
          scenario.label,
          `  whole-log read (undo before 2026-11-08): ${wholeLog.toFixed(1)} ms, ${(bytes / 1e6).toFixed(1)} MB as JSON`,
          `  head group read (undo now): ${headGroup.toFixed(2)} ms`,
          `  one action's rows (reversal): ${byAction.toFixed(2)} ms; plan: ${plan}`,
        ]
        process.stdout.write(`\n${lines.join('\n')}\n\n`)
      },
      300_000,
    )
  }
})
