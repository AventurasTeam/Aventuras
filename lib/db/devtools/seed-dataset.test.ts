import { desc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { getRollbackCounts, undoLastAction } from '@/lib/actions'
import { REF_COLUMNS, rowRefs } from '@/lib/actions/delta/live-refs'
import { deltas, storyEntries, type Delta } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { ID_PATTERN, IdBiMap, SUBSTITUTABLE_PREFIXES } from '@/lib/ids'
import { detectRichEntryHtml, parseMarkdownToHtml } from '@/lib/markdown'
import { entriesStore, resetAllStores } from '@/lib/stores'
import { selectUndoTarget } from '@/lib/undo'

import { buildSeedSteps } from './seed-dataset'

type Row = Record<string, unknown>

function rowsOf(name: string): Row[] {
  const step = buildSeedSteps().find((s) => s.name === name)
  expect(step, `step ${name}`).toBeDefined()
  return step!.rows as Row[]
}

const SUBSTITUTABLE = new Set<string>(SUBSTITUTABLE_PREFIXES)

// Every string reachable in a row, deep — mirrors what substituteIds walks at
// prompt-build time, so the scan sees ids wherever they hide (nested state
// JSON, sceneEntities arrays, delta targets).
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out)
  else if (value !== null && typeof value === 'object')
    for (const v of Object.values(value)) collectStrings(v, out)
}

function allSubstitutableIds(): Set<string> {
  const strings: string[] = []
  for (const step of buildSeedSteps()) for (const row of step.rows) collectStrings(row, strings)
  // A real id is prefix_<rest>; the underscore guard excludes bare kind words
  // like "item" that share a substitutable prefix but aren't ids.
  return new Set(strings.filter((s) => s.includes('_') && SUBSTITUTABLE.has(s.split('_')[0])))
}

describe('buildSeedSteps', () => {
  it('builds without throwing (every Zod parse in the dataset passes)', () => {
    expect(() => buildSeedSteps()).not.toThrow()
  })

  it('keeps foreign keys consistent across stories, branches, entries, chapters', () => {
    const storyIds = new Set(rowsOf('stories').map((r) => r.id))
    const branchRows = rowsOf('branches')
    const branchIds = new Set(branchRows.map((r) => r.id))
    const chapterIds = new Set(rowsOf('chapters').map((r) => r.id))

    for (const branch of branchRows) expect(storyIds).toContain(branch.storyId)
    for (const entry of rowsOf('story_entries')) {
      expect(branchIds).toContain(entry.branchId)
      if (entry.chapterId != null) expect(chapterIds).toContain(entry.chapterId)
    }
  })

  it('seeds the rich-rendering story with entries the detector actually flags', () => {
    const richEntries = rowsOf('story_entries').filter((r) => r.branchId === 'br_rich_main')
    expect(richEntries.length).toBeGreaterThanOrEqual(40)

    const flagged = richEntries.filter((r) =>
      detectRichEntryHtml(parseMarkdownToHtml(r.content as string)),
    )
    expect(flagged.length).toBeGreaterThanOrEqual(15)
  })

  it('routes every security probe through the rich path (a plain-path probe tests nothing)', () => {
    const probes = rowsOf('story_entries').filter(
      (r) => r.branchId === 'br_rich_main' && (r.content as string).startsWith('PROBE'),
    )
    expect(probes.length).toBeGreaterThanOrEqual(5)
    for (const probe of probes) {
      expect(
        detectRichEntryHtml(parseMarkdownToHtml(probe.content as string)),
        (probe.content as string).slice(0, 40),
      ).toBe(true)
    }
  })

  // The entry index skips `system` entries, so an anchor on one renders as dangling.
  it('anchors every entry ref on an indexable entry', () => {
    const kindOf = new Map(rowsOf('story_entries').map((r) => [r.id, r.kind]))
    const refs: [string, unknown][] = [
      ...rowsOf('threads').flatMap((r): [string, unknown][] => [
        [`${r.id}.triggeredAt`, r.triggeredAtEntryId],
        [`${r.id}.resolvedAt`, r.resolvedAtEntryId],
      ]),
      ...rowsOf('happenings').map((r): [string, unknown] => [
        `${r.id}.occurredAt`,
        r.occurredAtEntryId,
      ]),
      ...rowsOf('happening_awareness').map((r): [string, unknown] => [
        `${r.id}.learnedAt`,
        r.learnedAtEntryId,
      ]),
      ...rowsOf('entities').map((r): [string, unknown] => [
        `${r.id}.lastSeenAt`,
        (r.state as { lastSeenAt?: { entryId: string } | null } | null)?.lastSeenAt?.entryId,
      ]),
    ]
    for (const [label, entryId] of refs) {
      if (entryId == null) continue
      expect(kindOf.has(entryId), label).toBe(true)
      expect(kindOf.get(entryId), label).not.toBe('system')
    }
  })
})

// The substitution layer (lib/ids) only rewrites ids matching ID_PATTERN
// (prefix_<uuid>); a mnemonic id like char_kael passes through untouched and
// the turn fails on the placeholder return trip. The fixture must therefore
// carry real prefixed UUIDs — see docs/testing.md → Fixture + seed contract.
// A target with no assignment resolves to 'no-profile-assigned', which
// short-circuits generateStructured before the request is built — so the
// feature reads as "the mock isn't running" rather than "the seed is
// incomplete". Named explicitly rather than swept from AGENT_IDS: the registry
// carries targets nothing calls yet, and seeding those would assert nothing.
describe('seeded agent assignments', () => {
  const CALLED_TARGETS = ['classifier', 'suggestion', 'wizard-assist'] as const

  function seededSettings(): { assignments: Record<string, string>; profiles: { id: string }[] } {
    const [row] = rowsOf('app_settings') as unknown as {
      assignments: Record<string, string>
      profiles: { id: string }[]
    }[]
    expect(row).toBeDefined()
    return row!
  }

  it.each(CALLED_TARGETS)('resolves %s to a profile the seed actually defines', (target) => {
    const { assignments, profiles } = seededSettings()
    const profileId = assignments[target]
    expect(profileId, `${target} has no assignment`).toBeDefined()
    expect(profiles.map((p) => p.id)).toContain(profileId)
  })

  it('seeds a narrative-kind profile, which resolveModel finds by kind not assignment', () => {
    const [row] = rowsOf('app_settings') as unknown as { profiles: { kind: string }[] }[]
    expect(row!.profiles.some((p) => p.kind === 'narrative')).toBe(true)
  })
})

describe('seed id substitution contract', () => {
  // Canonical id prefix per LLM-facing kind (docs/data-model.md → ID shape).
  const ENTITY_PREFIX: Record<string, string> = {
    character: 'char',
    location: 'loc',
    item: 'item',
    faction: 'fact',
  }
  const TABLE_PREFIX: Record<string, (row: Row) => string | undefined> = {
    entities: (r) => ENTITY_PREFIX[r.kind as string],
    lore: () => 'lore',
    threads: () => 'thr',
    happenings: () => 'hap',
    chapters: () => 'chap',
  }

  it('gives every LLM-facing row a prefix_<uuid> id with the kind-correct prefix', () => {
    for (const [table, prefixOf] of Object.entries(TABLE_PREFIX)) {
      for (const row of rowsOf(table)) {
        const id = row.id as string
        expect(ID_PATTERN.test(id), `${table}: ${id}`).toBe(true)
        expect(id.split('_')[0], `${table}: ${id}`).toBe(prefixOf(row))
      }
    }
  })

  it('round-trips every substitutable id through IdBiMap.allocate without throwing', () => {
    const ids = allSubstitutableIds()
    expect(ids.size).toBeGreaterThan(0)
    const map = new IdBiMap()
    for (const id of ids) expect(() => map.allocate(id), id).not.toThrow()
  })

  it('assigns identical ids across repeated builds (deterministic fixture)', () => {
    const idsOf = () => buildSeedSteps().flatMap((s) => s.rows.map((r) => (r as Row).id))
    expect(idsOf()).toEqual(idsOf())
  })

  it('keeps entity + happening cross-references consistent after the id remap', () => {
    const entityIds = new Set(rowsOf('entities').map((r) => r.id))
    const happeningIds = new Set(rowsOf('happenings').map((r) => r.id))

    for (const inv of rowsOf('happening_involvements')) {
      expect(happeningIds, `involvement ${inv.id}`).toContain(inv.happeningId)
      expect(entityIds, `involvement ${inv.id}`).toContain(inv.entityId)
    }
    for (const aw of rowsOf('happening_awareness')) {
      expect(happeningIds, `awareness ${aw.id}`).toContain(aw.happeningId)
      expect(entityIds, `awareness ${aw.id}`).toContain(aw.characterId)
    }
    for (const e of rowsOf('entities')) {
      const state = e.state as { faction_id?: string | null; current_location_id?: string | null }
      if (state?.faction_id) expect(entityIds, `${e.id}.faction_id`).toContain(state.faction_id)
      if (state?.current_location_id)
        expect(entityIds, `${e.id}.current_location_id`).toContain(state.current_location_id)
    }
  })
})

// A link row with no create delta of its own makes any rollback that removes its parent refuse
// `no-create` (generation-pipeline.md → Reverse-replay), so the seeded stories could not roll back.
describe('seeded rollback', () => {
  const BATCH = 100
  const HERO_MAIN = 'br_hero_main'

  afterEach(() => {
    resetAllStores()
  })

  async function seededDb() {
    const handle = await createTestDb()
    for (const { table, rows } of buildSeedSteps())
      for (let i = 0; i < rows.length; i += BATCH)
        await handle.db.insert(table).values(rows.slice(i, i + BATCH) as never)
    return handle
  }

  // A writer outside the log names only rows it made itself, so a reversal removing a logged row
  // never meets a referrer it cannot reverse (generation-pipeline.md → Reverse-replay).
  it('names a logged row only from rows whose create is logged too', () => {
    const logged = new Set(
      (
        rowsOf('deltas') as {
          branchId: string
          targetTable: string
          targetId: string
          op: string
        }[]
      )
        .filter((d) => d.op === 'create')
        .map((d) => `${d.branchId}:${d.targetTable}:${d.targetId}`),
    )
    for (const table of Object.keys(REF_COLUMNS)) {
      for (const row of rowsOf(table)) {
        if (logged.has(`${row.branchId as string}:${table}:${row.id as string}`)) continue
        for (const ref of rowRefs(table, row))
          expect(logged, `${table} ${row.id as string}`).not.toContain(
            `${row.branchId as string}:${ref.table}:${ref.id}`,
          )
      }
    }
  })

  // A pass's writes land as one burst under the branch write lock (generation-pipeline.md →
  // No-gate write phase), so nothing else commits between them.
  it('logs the hero happening fire as one contiguous action', () => {
    const fire = (rowsOf('deltas') as { branchId: string; actionId: string; logPosition: number }[])
      .filter((r) => r.branchId === 'br_hero_main' && r.actionId === 'act_class_1')
      .map((r) => r.logPosition)
      .sort((a, b) => a - b)

    expect(fire).toHaveLength(4)
    expect(fire[fire.length - 1]! - fire[0]!).toBe(fire.length - 1)
  })

  // A link names its happening, so the writer that creates the happening creates the link with it,
  // or a later pass adds one; a link logged first would name a row that did not exist yet.
  it('logs each link create with its happening or after it', () => {
    type DeltaRow = {
      branchId: string
      actionId: string
      targetTable: string
      targetId: string
      op: string
      logPosition: number
    }
    const rows = rowsOf('deltas') as DeltaRow[]
    const key = (branchId: unknown, id: unknown) => `${branchId as string}:${id as string}`
    const happeningCreate = new Map(
      rows
        .filter((d) => d.targetTable === 'happenings' && d.op === 'create')
        .map((d) => [key(d.branchId, d.targetId), d]),
    )
    const linkHappening = new Map(
      ['happening_awareness', 'happening_involvements'].flatMap((table) =>
        rowsOf(table).map((r) => [`${table}:${key(r.branchId, r.id)}`, r.happeningId]),
      ),
    )

    let withHappening = 0
    let later = 0
    for (const d of rows) {
      const happeningId = linkHappening.get(`${d.targetTable}:${key(d.branchId, d.targetId)}`)
      const parent = happeningCreate.get(key(d.branchId, happeningId))
      if (d.op !== 'create' || parent == null) continue
      if (d.actionId === parent.actionId) {
        withHappening++
        continue
      }
      const parentEnd = Math.max(
        ...rows.filter((r) => r.actionId === parent.actionId).map((r) => r.logPosition),
      )
      expect(d.logPosition, `${d.targetTable} ${d.targetId}`).toBeGreaterThan(parentEnd)
      later++
    }
    expect(withHappening).toBeGreaterThan(0)
    expect(later).toBeGreaterThan(0)
  })

  // Every seeded branch, not just the hero's: hap_fire anchors at entry 22 and its links at 22 and
  // 25, so the hero's earlier rollbacks sweep them and the later ones spare them.
  it('previews a rollback to every seeded entry above the opening', async () => {
    const { db, runInTransaction } = await seededDb()
    const entries = (
      rowsOf('story_entries') as { id: string; branchId: string; kind: string; position: number }[]
    ).filter((r) => r.kind !== 'opening')
    expect(entries.length).toBeGreaterThan(100)

    for (const entry of entries) {
      const counts = await getRollbackCounts(entry.branchId, entry.id, { db, runInTransaction })
      expect(counts, `${entry.branchId} entry ${entry.position}`).toEqual({
        entries: expect.any(Number),
        chapters: expect.any(Number),
        worldStateChanges: expect.any(Number),
      })
    }
  })

  // A close has no entry anchor, so it reverses by its own log position: chapter 1's commits after
  // entry 31 and chapter 2's after entry 59.
  it('takes back only the chapter closes logged at or past the rollback target', async () => {
    const ctx = await seededDb()
    const expected: Record<string, number> = {
      entry_hero_0002: 2,
      entry_hero_0031: 2,
      entry_hero_0032: 1,
      entry_hero_0059: 1,
      entry_hero_0060: 0,
      entry_hero_0070: 0,
    }
    const actual: Record<string, unknown> = {}
    for (const target of Object.keys(expected)) {
      const counts = await getRollbackCounts(HERO_MAIN, target, ctx)
      actual[target] = 'chapters' in counts ? counts.chapters : counts
    }
    expect(actual).toEqual(expected)
  })

  // CTRL-Z steps over periodic passes, so the fire's pass goes only with the turn it anchors to.
  it('walks CTRL-Z from the hero head to the opening without selecting the periodic pass', async () => {
    const ctx = await seededDb()
    const branchEntries = await ctx.db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, HERO_MAIN))
      .orderBy(storyEntries.position)
    entriesStore.hydrate(HERO_MAIN, branchEntries)
    const nextTarget = async () =>
      selectUndoTarget(
        (await ctx.db
          .select()
          .from(deltas)
          .where(eq(deltas.branchId, HERO_MAIN))
          .orderBy(desc(deltas.logPosition))) as Delta[],
      )

    const selected: string[] = []
    let target = await nextTarget()
    for (let press = 0; target != null && press < 200; press++) {
      selected.push(target.actionId)
      expect(await undoLastAction(HERO_MAIN, ctx), target.actionId).toEqual({ status: 'ok' })
      target = await nextTarget()
    }

    expect(target).toBeNull()
    expect(selected).toContain('act_create_br_hero_main_entry_hero_0022')
    expect(selected).not.toContain('act_class_1')
  })
})
