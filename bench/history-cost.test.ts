import { describe, it } from 'vitest'

import {
  branches,
  characterRelationships,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  type DbCtx,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { loadHistoryChunk, memoizedLinkEndScan, type HistoryQuery } from '@/lib/history'

import { seededRandom } from './fixture'

// Cost harness, not a test — it asserts nothing. Run with `pnpm bench:history` when a change moves
// the History tab's union (lib/history). A tab's first load after a refresh trigger scans every
// delete on the branch for link rows naming its row ("scanning"); its other loads reuse that scan
// ("reused"). The tab row's deltas sit at the start of the log, the far end from newest-first.

type Scenario = { label: string; deltas: number; deleteShare: number; held: number }

const SCENARIOS: Scenario[] = [
  {
    label: 'typical: 30k deltas, 2% deletes, 6 held links each',
    deltas: 30_000,
    deleteShare: 0.02,
    held: 6,
  },
  {
    label: 'delete-heavy: 30k deltas, 30% deletes, 24 held links each',
    deltas: 30_000,
    deleteShare: 0.3,
    held: 24,
  },
]

const BRANCH = 'b1'
const TARGET = 'char_t'
const CHARACTERS = 300
const HAPPENINGS = 1500
const PROSE =
  'The rain kept on through the night, and the lamps along the quay burned low. '.repeat(4)

type Db = DbCtx['db']

function chunks<T>(rows: T[], size = 100): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

const characterRow = (id: string, name: string) => ({
  id,
  branchId: BRANCH,
  kind: 'character' as const,
  name,
  description: PROSE,
  status: 'active' as const,
  injectionMode: 'auto' as const,
  createdAt: 1,
  updatedAt: 1,
})

const relationshipRow = (id: string, aId: string, bId: string) => ({
  id,
  branchId: BRANCH,
  aId,
  bId,
  kind: 'ally',
  inverseKind: 'trusts',
  createdAt: 1,
  updatedAt: 1,
})

const awarenessRow = (id: string, characterId: string, happeningId: string) => ({
  id,
  branchId: BRANCH,
  characterId,
  happeningId,
  learnedAtEntryId: null,
  decayResistance: 0.5,
  retrievalCount: 3,
  source: 'witnessed',
})

const involvementRow = (id: string, entityId: string, happeningId: string) => ({
  id,
  branchId: BRANCH,
  entityId,
  happeningId,
  role: 'witness',
})

function fullEntityPayload(id: string, links: Record<string, unknown[]>) {
  return {
    ...characterRow(id, `Gone ${id}`),
    retiredReason: null,
    nameCollisionFlag: 0,
    state: {
      visual: { hair: 'dark' },
      traits: ['wary', 'loyal'],
      drives: ['home'],
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      faction_id: null,
      lastSeenAt: null,
    },
    tags: ['guard'],
    keywords: [`${id} the elder`],
    priority: 0,
    embeddingStale: 0,
    translations: [],
    ...links,
  }
}

async function seed(scenario: Scenario): Promise<Db> {
  const { db, sqlite } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 's1', name: 'main', createdAt: 1 })
  const people = [characterRow(TARGET, 'Aria')]
  for (let i = 0; i < CHARACTERS; i += 1) people.push(characterRow(`char_${i}`, `Person ${i}`))
  for (const rows of chunks(people)) await db.insert(entities).values(rows)
  const events = Array.from({ length: HAPPENINGS }, (_, i) => ({
    id: `hap_${i}`,
    branchId: BRANCH,
    title: `Happening ${i}`,
    createdAt: 1,
    updatedAt: 1,
  }))
  for (const rows of chunks(events)) await db.insert(happenings).values(rows)

  // The tab's own live links: 12 relationships, 40 awareness rows, 15 involvements.
  const rels = Array.from({ length: 12 }, (_, i) =>
    relationshipRow(`rel_t${i}`, `char_${i}`, TARGET),
  )
  const aware = Array.from({ length: 40 }, (_, i) => awarenessRow(`haw_t${i}`, TARGET, `hap_${i}`))
  const inv = Array.from({ length: 15 }, (_, i) =>
    involvementRow(`hinv_t${i}`, TARGET, `hap_${40 + i}`),
  )
  await db.insert(characterRelationships).values(rels)
  await db.insert(happeningAwareness).values(aware)
  await db.insert(happeningInvolvements).values(inv)

  const rand = seededRandom(7)
  const insert = sqlite.prepare(
    `INSERT INTO deltas (id, branch_id, entry_id, action_id, log_position, source, target_table, target_id, op, undo_payload, encoding_version, created_at)
     VALUES (?, ?, NULL, ?, ?, 'user_edit', ?, ?, ?, ?, 1, ?)`,
  )
  let position = 0
  const write = (table: string, id: string, op: string, payload: unknown) => {
    position += 1
    insert.run(
      `delta_${position}`,
      BRANCH,
      `act_${position}`,
      position,
      table,
      id,
      op,
      payload == null ? null : JSON.stringify(payload),
      position,
    )
  }
  const pick = (n: number) => Math.floor(rand() * n)
  const heldFor = (gone: string, count: number) => ({
    relationships: Array.from({ length: Math.ceil(count / 4) }, (_, k) =>
      relationshipRow(`rel_${gone}_${k}`, `char_${pick(CHARACTERS)}`, gone),
    ),
    involvements: Array.from({ length: Math.ceil(count / 4) }, (_, k) =>
      involvementRow(`hinv_${gone}_${k}`, gone, `hap_${pick(HAPPENINGS)}`),
    ),
    awareness: Array.from({ length: Math.ceil(count / 2) }, (_, k) =>
      awarenessRow(`haw_${gone}_${k}`, gone, `hap_${pick(HAPPENINGS)}`),
    ),
  })

  sqlite.exec('BEGIN')
  // The tab's own history and its links' edits.
  for (let i = 0; i < 50; i += 1) write('entities', TARGET, 'update', { description: PROSE })
  for (const row of [...rels, ...aware, ...inv]) {
    const table =
      'aId' in row
        ? 'character_relationships'
        : 'role' in row
          ? 'happening_involvements'
          : 'happening_awareness'
    write(table, row.id, 'create', null)
    for (let k = 0; k < 3; k += 1)
      write(table, row.id, 'update', 'role' in row ? { role: 'bystander' } : { source: 'told' })
  }
  // Removals naming the tab's row: 15 link rows deleted on their own, 20 other ends' deletes.
  for (let i = 0; i < 15; i += 1)
    write(
      'happening_awareness',
      `haw_gone_t${i}`,
      'delete',
      awarenessRow(`haw_gone_t${i}`, TARGET, `hap_${100 + i}`),
    )
  for (let i = 0; i < 20; i += 1) {
    const gone = `char_gone_t${i}`
    const held = heldFor(gone, scenario.held)
    held.relationships.push(relationshipRow(`rel_gone_t${i}`, gone, TARGET))
    write('entities', gone, 'delete', fullEntityPayload(gone, held))
  }

  // Filler: everyone else's edits, with the scenario's share of deletes.
  while (position < scenario.deltas) {
    if (rand() < scenario.deleteShare) {
      const gone = `gone_${position}`
      if (rand() < 1 / 3)
        write(
          'happening_awareness',
          gone,
          'delete',
          awarenessRow(gone, `char_${pick(CHARACTERS)}`, `hap_${pick(HAPPENINGS)}`),
        )
      else if (rand() < 0.5)
        write('happenings', gone, 'delete', {
          id: gone,
          branchId: BRANCH,
          title: `Lost ${gone}`,
          description: PROSE,
          createdAt: 1,
          updatedAt: 1,
          involvements: heldFor(gone, scenario.held).involvements,
          awareness: heldFor(gone, scenario.held).awareness,
        })
      else write('entities', gone, 'delete', fullEntityPayload(gone, heldFor(gone, scenario.held)))
      continue
    }
    const roll = rand()
    if (roll < 0.5) write('entities', `char_${pick(CHARACTERS)}`, 'update', { description: PROSE })
    else if (roll < 0.8)
      write('happening_awareness', `haw_${pick(5000)}`, 'update', { retrievalCount: 2 })
    else write('happenings', `hap_${pick(HAPPENINGS)}`, 'create', null)
  }
  sqlite.exec('COMMIT')
  return db
}

async function time(fn: () => Promise<unknown>, runs = 30): Promise<string> {
  for (let i = 0; i < 3; i += 1) await fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const at = (q: number) => samples[Math.min(runs - 1, Math.floor(runs * q))]!.toFixed(2)
  return `median ${at(0.5)} ms, p90 ${at(0.9)} ms`
}

describe('History union cost', () => {
  it('prints the per-load cost profile', async () => {
    const lines: string[] = []
    for (const scenario of SCENARIOS) {
      const db = await seed(scenario)
      const base: HistoryQuery = {
        branchId: BRANCH,
        targetTable: 'entities',
        targetId: TARGET,
        sort: 'newest',
        cursor: null,
      }
      const first = await loadHistoryChunk(db, base)
      lines.push(`${scenario.label}`)
      lines.push(
        `  first page: ${first.rows.length} rows, ${Object.keys(first.names).length} names`,
      )
      const loads: [string, HistoryQuery][] = [
        ['page load', base],
        ["search, no hit 'zqx'", { ...base, search: 'zqx' }],
        ["search, name 'Person'", { ...base, search: 'Person' }],
        ['load older', { ...base, cursor: first.nextCursor }],
      ]
      // A tab's first load after a refresh trigger scans; every other load reuses that scan.
      const scan = memoizedLinkEndScan()
      await loadHistoryChunk(db, base, scan)
      for (const [label, query] of loads) {
        lines.push(`  ${label}`)
        lines.push(`    scanning:  ${await time(() => loadHistoryChunk(db, query))}`)
        lines.push(`    reused:    ${await time(() => loadHistoryChunk(db, query, scan))}`)
      }
    }
    process.stdout.write(`\n${lines.join('\n')}\n\n`)
  }, 300_000)
})
