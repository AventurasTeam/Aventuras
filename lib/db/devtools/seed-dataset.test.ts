import { desc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { getRollbackCounts, undoLastAction } from '@/lib/actions'
import { REF_COLUMNS, rowRefs } from '@/lib/actions/delta/live-refs'
import { isContentEditDelta } from '@/lib/actions/story-entries/classifier-facts'
import { ENTRIES_WINDOW_SIZE } from '@/lib/actions/story-entries/recent-window'
import {
  closeReportSchema,
  deltas,
  isCloseReasonKey,
  storyEntries,
  type Delta,
  type NewStoryEntry,
  type StorySettings,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { ID_PATTERN, IdBiMap, SUBSTITUTABLE_PREFIXES } from '@/lib/ids'
import { detectRichEntryHtml, parseMarkdownToHtml } from '@/lib/markdown'
import {
  CHAPTER_CLOSE_KIND,
  ensureChapterClosePipelineRegistered,
  getPipeline,
} from '@/lib/pipeline'
import { runPreflight } from '@/lib/pipeline/runtime/preflight'
import { entriesStore, resetAllStores, type AppSettingsSnapshot } from '@/lib/stores'
import { countTokens } from '@/lib/tokens'
import {
  countEncoderBuilds,
  stopCountingEncoderBuilds,
} from '@/lib/tokens/__tests__/count-encoder-builds'
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
  const CALLED_TARGETS = ['classifier', 'suggestion', 'wizard-assist', 'lore-mgmt'] as const

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

const BATCH = 100
const HERO_MAIN = 'br_hero_main'

async function seededDb() {
  const handle = await createTestDb()
  for (const { table, rows } of buildSeedSteps())
    for (let i = 0; i < rows.length; i += BATCH)
      await handle.db.insert(table).values(rows.slice(i, i + BATCH) as never)
  return handle
}

// A link row with no create delta makes any rollback removing its parent refuse `no-create`
// (generation-pipeline.md → Reverse-replay): seeded stories must roll back.
describe('seeded rollback', () => {
  afterEach(() => {
    resetAllStores()
  })

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

  // Pins the fixture's layout, not a runtime guarantee: a refresh beside a live pass can
  // interleave a metadata delta (cadence.md → Concurrency).
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

  // A close anchors on its chapter's end entry: a rollback to that entry or into the chapter takes
  // the close, and one past the end spares it (data-model.md → Survival anchor).
  it('takes back a close only when the rollback reaches its end entry', async () => {
    const ctx = await seededDb()
    const expected: Record<string, number> = {
      entry_hero_0002: 2,
      entry_hero_0029: 2,
      entry_hero_0030: 1,
      entry_hero_0031: 1,
      entry_hero_0032: 1,
      entry_hero_0057: 1,
      entry_hero_0058: 0,
      entry_hero_0059: 0,
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

// C8: a seeded close takes the shape a real one writes (C1), so reversal reads it as it reads a close.
describe('seeded chapter closes', () => {
  type ChapterRow = {
    id: string
    branchId: string
    sequenceNumber: number
    startEntryId: string
    endEntryId: string
    closeReport?: unknown
  }
  type EntryRow = {
    id: string
    branchId: string
    kind: string
    position: number
    chapterId: string | null
  }
  type DeltaRow = Pick<
    Delta,
    | 'branchId'
    | 'entryId'
    | 'actionId'
    | 'logPosition'
    | 'source'
    | 'targetTable'
    | 'targetId'
    | 'op'
    | 'undoPayload'
  >

  const heroChapters = (): ChapterRow[] =>
    (rowsOf('chapters') as unknown as ChapterRow[])
      .filter((c) => c.branchId === HERO_MAIN)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const heroEntries = (): EntryRow[] =>
    (rowsOf('story_entries') as unknown as EntryRow[])
      .filter((e) => e.branchId === HERO_MAIN)
      .sort((a, b) => a.position - b.position)
  const heroLog = (): DeltaRow[] =>
    (rowsOf('deltas') as unknown as DeltaRow[])
      .filter((d) => d.branchId === HERO_MAIN)
      .sort((a, b) => a.logPosition - b.logPosition)

  afterEach(() => {
    resetAllStores()
  })

  it('ends every seeded chapter on a reply and starts the next right after it', () => {
    const byId = new Map(heroEntries().map((e) => [e.id, e]))
    const closes = heroChapters()
    expect(closes).toHaveLength(2)
    let previousEnd = 0
    for (const chapter of closes) {
      const end = byId.get(chapter.endEntryId)
      expect(end?.kind, chapter.id).toBe('ai_reply')
      expect(byId.get(chapter.startEntryId)?.position, chapter.id).toBe(previousEnd + 1)
      previousEnd = end!.position
    }
  })

  it('logs each close as its create, a stamp per entry, then any agent writes and its report', () => {
    const log = heroLog()
    const entries = heroEntries()
    const tails: DeltaRow[][] = []
    for (const chapter of heroChapters()) {
      const create = log.find(
        (d) => d.targetTable === 'chapters' && d.op === 'create' && d.targetId === chapter.id,
      )
      expect(create, `${chapter.id} create`).toBeDefined()
      const group = log.filter((d) => d.actionId === create!.actionId)
      const stamped = entries.filter((e) => e.chapterId === chapter.id)
      expect(stamped.length, chapter.id).toBeGreaterThan(0)
      const head = group.slice(0, stamped.length + 1)
      expect(head.map((d) => [d.targetTable, d.op, d.targetId])).toEqual([
        ['chapters', 'create', chapter.id],
        ...stamped.map((e) => ['story_entries', 'update', e.id]),
      ])
      for (const delta of head.slice(1))
        expect(delta.undoPayload, delta.targetId).toEqual({ chapterId: null })
      for (const delta of group) {
        expect(delta.entryId, delta.targetId).toBe(chapter.endEntryId)
        expect(delta.source, delta.targetId).toBe('chapter_close')
      }
      expect(group.at(-1)!.logPosition - group[0]!.logPosition, chapter.id).toBe(group.length - 1)
      tails.push(group.slice(stamped.length + 1))
    }
    // C1: a close that wrote its report ends on its agent writes, then the report update.
    expect(tails[0], 'chapter 1, which no close wrote a report for').toEqual([])
    expect(tails[1]!.map((d) => [d.targetTable, d.op])).toEqual([
      ['entities', 'update'],
      ['chapters', 'update'],
    ])
    expect(tails[1]!.at(-1)).toMatchObject({
      targetId: heroChapters()[1]!.id,
      undoPayload: { closeReport: null },
    })
  })

  it("gives chapter 2 a report its close's action wrote, and chapter 1 none", () => {
    const [first, second] = heroChapters()
    expect(first!.closeReport ?? null, first!.id).toBeNull()
    const report = closeReportSchema.parse(second!.closeReport)
    const create = heroLog().find(
      (d) => d.targetTable === 'chapters' && d.op === 'create' && d.targetId === second!.id,
    )
    expect(report.actionId).toBe('act_chapter_2')
    expect(create?.actionId).toBe('act_chapter_2')
    expect(report.calls.map((c) => [c.task, c.tool, c.result])).toEqual([
      ['identity', 'update_character', 'skipped'],
      ['identity', 'update_character', 'ok'],
    ])
    expect(report.stopped).toEqual([{ task: 'identity', part: 1, reason: 'budget' }])
    expect(report.noToolCalls).toBe(false)

    const reasons = report.calls.flatMap((c) => [
      ...(c.reason === undefined ? [] : [c.reason]),
      ...(c.skippedFields ?? []).map((f) => f.reason),
    ])
    expect(reasons).toEqual(['user-edited-since-prose'])
    for (const reason of reasons) expect(isCloseReasonKey(reason), reason).toBe(true)

    // The review cites from turns, never from a delta's anchor: each is a chapter 2 entry.
    const inChapter = new Set(
      heroEntries()
        .filter((e) => e.chapterId === second!.id)
        .map((e) => e.id),
    )
    for (const call of report.calls) {
      expect(call.turns.length, call.tool).toBeGreaterThan(0)
      for (const turn of call.turns) expect(inChapter.has(turn), turn).toBe(true)
    }
    const nameOf = new Map(rowsOf('entities').map((r) => [r.id, r.name]))
    for (const call of report.calls)
      for (const row of call.rows) expect(nameOf.get(row.id), row.id).toBe(row.name)
  })

  // The review takes a landed field's old value from its delta and the new one from the report.
  it("pairs chapter 2's landed write with its agent delta and the row it left", () => {
    const report = closeReportSchema.parse(heroChapters()[1]!.closeReport)
    const landed = report.calls.filter((c) => c.result === 'ok')
    expect(landed).toHaveLength(1)
    expect(landed[0]!.values).toEqual({ 'state.traits': 'patient, merciless' })
    const agent = heroLog().filter(
      (d) => d.actionId === report.actionId && d.targetTable === 'entities',
    )
    expect(agent).toHaveLength(1)
    expect(agent[0]!.targetId).toBe(landed[0]!.rows[0]!.id)
    expect(agent[0]!.undoPayload).toEqual({ state: { traits: ['patient'] } })
    const row = rowsOf('entities').find((r) => r.id === agent[0]!.targetId)
    expect((row?.state as { traits?: string[] } | undefined)?.traits).toEqual([
      'patient',
      'merciless',
    ])
  })

  // C5: token_count is the closed range's content_tokens, summed at close.
  it("counts each chapter's tokens over its range", async () => {
    const { sqlite } = await seededDb()
    const rows = sqlite
      .prepare(
        `SELECT c.id AS id, c.token_count AS tokenCount,
           (SELECT SUM(e.content_tokens) FROM story_entries e
             WHERE e.branch_id = c.branch_id AND e.kind != 'system'
               AND e.position BETWEEN s.position AND x.position) AS summed
         FROM chapters c
         JOIN story_entries s ON s.branch_id = c.branch_id AND s.id = c.start_entry_id
         JOIN story_entries x ON x.branch_id = c.branch_id AND x.id = c.end_entry_id`,
      )
      .all() as { id: string; tokenCount: number; summed: number }[]
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.tokenCount, row.id).toBeGreaterThan(0)
      expect(row.tokenCount, row.id).toBe(row.summed)
    }
  })

  // C2 declares lore-mgmt on three phases, so an unassigned seed fails every close at pre-flight.
  it('passes the chapter-close pre-flight on the seeded settings', () => {
    ensureChapterClosePipelineRegistered()
    const [appSettingsRow] = rowsOf('app_settings') as unknown as AppSettingsSnapshot[]
    const hero = rowsOf('stories').find((s) => s.id === 'story_hero') as
      | { settings: StorySettings }
      | undefined
    expect(hero).toBeDefined()

    expect(
      runPreflight(getPipeline(CHAPTER_CLOSE_KIND), {
        appSettings: appSettingsRow!,
        storySettings: hero!.settings,
      }),
    ).toBeNull()
  })
})

// Over every row, never by entry position: seeded chapter boundaries can move.
describe('seeded content tokens', () => {
  type EntryRow = Pick<
    NewStoryEntry,
    'id' | 'branchId' | 'kind' | 'content' | 'contentTokens' | 'chapterId'
  >

  function entries(): EntryRow[] {
    return rowsOf('story_entries') as EntryRow[]
  }

  it('counts every non-system row from its stored content', () => {
    const counted = entries().filter((e) => e.kind !== 'system')
    expect(counted.length).toBeGreaterThan(100)
    for (const entry of counted) {
      expect(entry.contentTokens, entry.id).toBe(countTokens(entry.content))
      expect(entry.contentTokens, entry.id).toBeGreaterThan(0)
    }
  })

  // e2e/tests/chapter-progress.spec.ts proves the strip reads past the reader's window here.
  it('seeds the rich story past the reader window', () => {
    const open = entries().filter(
      (e) => e.branchId === 'br_rich_main' && e.kind !== 'system' && e.chapterId == null,
    )
    expect(open.length).toBeGreaterThan(ENTRIES_WINDOW_SIZE)
  })

  it('leaves system rows uncounted, as writeSystemEntry does', () => {
    const system = entries().filter((e) => e.kind === 'system')
    expect(system.length).toBeGreaterThan(0)
    for (const entry of system) expect(entry.contentTokens ?? null, entry.id).toBeNull()
  })

  // A payload holding only the text would restore it and leave the edited count on the row.
  it('records the old count in every seeded content edit', () => {
    const edits = (rowsOf('deltas') as unknown as Delta[]).filter(isContentEditDelta)
    expect(edits.length).toBeGreaterThan(0)
    for (const edit of edits) {
      const payload = edit.undoPayload as { content: string; contentTokens?: number }
      expect(payload.contentTokens, edit.id).toBe(countTokens(payload.content))
    }
  })
})

// docs/testing.md → Fixture + seed contract: no seeded branch owes a pass at its first Send.
describe('seeded classifier watermarks', () => {
  type BranchRow = { id: string; classifierStatus: unknown }
  type EntryRow = { branchId: string; kind: string; position: number }

  it('parks every branch idle at its last non-system entry', () => {
    const entries = rowsOf('story_entries') as EntryRow[]
    const branchRows = rowsOf('branches') as BranchRow[]
    expect(branchRows.length).toBeGreaterThan(1)
    for (const branch of branchRows) {
      const prose = entries.filter((e) => e.branchId === branch.id && e.kind !== 'system')
      expect(prose.length, branch.id).toBeGreaterThan(0)
      expect(branch.classifierStatus, branch.id).toEqual({
        state: 'idle',
        lastSuccessAt: null,
        lastError: null,
        processedThrough: Math.max(...prose.map((e) => e.position)),
      })
    }
  })

  it('seeds at most one system row per branch, at its tail', () => {
    const entries = rowsOf('story_entries') as EntryRow[]
    for (const branch of rowsOf('branches') as BranchRow[]) {
      const rows = entries.filter((e) => e.branchId === branch.id)
      const tail = Math.max(...rows.map((e) => e.position))
      const system = rows.filter((e) => e.kind === 'system').map((e) => e.position)
      expect(system.length, branch.id).toBeLessThanOrEqual(1)
      for (const position of system) expect(position, branch.id).toBe(tail)
    }
  })

  // A watermark at 72 would cover the user_action the first Send writes there, unread by any pass.
  it('parks br_hero_main on its last reply, below the system row it ends on', () => {
    const tail = (rowsOf('story_entries') as EntryRow[])
      .filter((e) => e.branchId === 'br_hero_main')
      .sort((a, b) => b.position - a.position)
    expect(tail.slice(0, 2).map((e) => [e.kind, e.position])).toEqual([
      ['system', 72],
      ['ai_reply', 71],
    ])
    const hero = (rowsOf('branches') as BranchRow[]).find((b) => b.id === 'br_hero_main')
    expect(hero?.classifierStatus).toMatchObject({ processedThrough: 71 })
  })

  it('parks the fork, the rich story and a filler on their own last entries', () => {
    const statusOf = new Map(
      (rowsOf('branches') as BranchRow[]).map((b) => [b.id, b.classifierStatus]),
    )
    expect(statusOf.get('br_hero_fork')).toMatchObject({ processedThrough: 12 })
    expect(statusOf.get('br_rich_main')).toMatchObject({ processedThrough: 60 })
    expect(statusOf.get('br_active2_main')).toMatchObject({ processedThrough: 4 })
  })
})

// lib/db re-exports the native reseed, so Android evaluates this module on every launch, and the
// encoder takes about a second to build there.
describe('importing the seed', () => {
  afterEach(stopCountingEncoderBuilds)

  it('builds no token encoder until a seed build counts a row', async () => {
    const built = countEncoderBuilds()

    const seed = await import('./seed-dataset')
    expect(built).not.toHaveBeenCalled()

    seed.buildSeedSteps()
    expect(built).toHaveBeenCalledTimes(1)
  })
})
