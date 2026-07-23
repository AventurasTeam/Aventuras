import { describe, expect, it } from 'vitest'

import { ID_PATTERN, IdBiMap, SUBSTITUTABLE_PREFIXES } from '@/lib/ids'
import { detectRichEntryHtml, parseMarkdownToHtml } from '@/lib/markdown'

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
    const richEntries = rowsOf('story_entries').filter((r) => r.branchId === 'branch_rich_main')
    expect(richEntries.length).toBeGreaterThanOrEqual(40)

    const flagged = richEntries.filter((r) =>
      detectRichEntryHtml(parseMarkdownToHtml(r.content as string)),
    )
    expect(flagged.length).toBeGreaterThanOrEqual(15)
  })

  it('routes every security probe through the rich path (a plain-path probe tests nothing)', () => {
    const probes = rowsOf('story_entries').filter(
      (r) => r.branchId === 'branch_rich_main' && (r.content as string).startsWith('PROBE'),
    )
    expect(probes.length).toBeGreaterThanOrEqual(5)
    for (const probe of probes) {
      expect(
        detectRichEntryHtml(parseMarkdownToHtml(probe.content as string)),
        (probe.content as string).slice(0, 40),
      ).toBe(true)
    }
  })
})

// The substitution layer (lib/ids) only rewrites ids matching ID_PATTERN
// (prefix_<uuid>); a mnemonic id like char_kael passes through untouched and
// the turn fails on the placeholder return trip. The fixture must therefore
// carry real prefixed UUIDs — see docs/testing.md → Fixture + seed contract.
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
