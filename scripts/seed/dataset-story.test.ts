import { getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  DATASET_SEED_LEFT_OUT,
  DATASET_SEED_TABLES,
  parseStorySeed,
  seedProviderIds,
} from './dataset-story'
import { buildSeedSteps } from '../../lib/db/devtools/seed-dataset'
import { dbSchema } from '../../lib/db/schema'

type Row = Record<string, unknown>
type Seed = Record<string, Row[]>

const HERO = 'story_hero'
const HERO_BRANCHES = new Set(['br_hero_main', 'br_hero_fork'])
const PROVIDERS = seedProviderIds(buildSeedSteps())

// The default seed's hero story: every table the seed carries has a row, two branches among them.
function heroSeed(): Seed {
  const steps = buildSeedSteps()
  const seed: Seed = {}
  for (const { name } of DATASET_SEED_TABLES) {
    const rows = steps.filter((s) => s.name === name).flatMap((s) => s.rows as Row[])
    seed[name] = structuredClone(
      rows.filter((r) =>
        name === 'stories'
          ? r.id === HERO
          : name === 'branches'
            ? r.storyId === HERO
            : HERO_BRANCHES.has(r.branchId as string),
      ),
    )
  }
  return seed
}

const parse = (seed: Seed) => parseStorySeed(JSON.stringify(seed), PROVIDERS)

// A table a later migration adds fails here until someone decides whether a story seed carries it.
it('decides every table: seeded, or left out with a reason', () => {
  const seeded = DATASET_SEED_TABLES.map((spec) => spec.name)
  const leftOut = Object.keys(DATASET_SEED_LEFT_OUT)
  expect([...seeded, ...leftOut].sort()).toEqual(Object.values(dbSchema).map(getTableName).sort())
  for (const reason of Object.values(DATASET_SEED_LEFT_OUT)) expect(reason).not.toBe('')
})

describe('parseStorySeed', () => {
  it('returns one step per table, in insert order, holding every row', () => {
    const seed = heroSeed()
    const steps = parse(seed)
    expect(steps.map((s) => s.name)).toEqual([
      'stories',
      'branches',
      'story_entries',
      'chapters',
      'entities',
      'character_relationships',
      'lore',
      'threads',
      'happenings',
      'happening_involvements',
      'happening_awareness',
      'branch_era_flips',
      'translations',
      'entry_assets',
      'deltas',
    ])
    for (const step of steps) expect(step.rows, step.name).toEqual(seed[step.name])
    expect(steps.find((s) => s.name === 'branches')!.rows).toHaveLength(2)
    expect(steps.find((s) => s.name === 'deltas')!.rows.length).toBeGreaterThan(50)
  })

  it('refuses a column its table lacks, naming the row', () => {
    const seed = heroSeed()
    seed.entities![2]!.vector = [0.1, 0.2]
    expect(() => parse(seed)).toThrow(/entities\[2\][\s\S]*vector/)
  })

  it('refuses a JSON column its schema rejects', () => {
    const seed = heroSeed()
    ;(seed.story_entries![4]!.metadata as Row).sceneEntities = 'char_kael'
    expect(() => parse(seed)).toThrow(/story_entries\[4\]/)
  })

  it.each([
    ['stories', 'definition', (v: Row) => ({ ...v, narration: 'fourth' })],
    ['stories', 'settings', (v: Row) => ({ ...v, classifierCadence: 0 })],
    ['chapters', 'closeReport', () => ({ calls: 'none' })],
  ])('refuses a %s.%s its schema rejects', (table, column, broken) => {
    const seed = heroSeed()
    const row = seed[table]![0]!
    row[column] = broken(row[column] as Row)
    expect(() => parse(seed)).toThrow(new RegExp(`${table}\\[0\\][\\s\\S]*${column}`))
  })

  it('refuses an entity state its kind does not allow', () => {
    const seed = heroSeed()
    const character = seed.entities!.findIndex((r) => r.kind === 'character')
    ;(seed.entities![character]!.state as Row).traits = 'brave'
    expect(() => parse(seed)).toThrow(new RegExp(`entities\\[${character}\\]`))
  })

  it('refuses a row marked embedded, since the seed carries no vector', () => {
    const seed = heroSeed()
    seed.threads![0]!.embeddingStale = 0
    expect(() => parse(seed)).toThrow(/threads\[0\][\s\S]*embeddingStale/)
  })

  it('refuses a happening with both anchors, by its write schema', () => {
    const seed = heroSeed()
    const anchored = seed.happenings!.findIndex((r) => r.occurredAtEntryId != null)
    seed.happenings![anchored]!.temporal = 'long ago'
    expect(() => parse(seed)).toThrow(/mutually exclusive/)
  })

  it.each([
    ['entities', 'tags', 'brave'],
    ['lore', 'priority', 101],
    ['character_relationships', 'kind', ''],
    ['happening_awareness', 'decayResistance', 2],
    ['branch_era_flips', 'atWorldtime', -1],
    ['translations', 'translatedText', ''],
  ])('refuses a %s.%s its write schema rejects', (table, column, value) => {
    const seed = heroSeed()
    seed[table]![0]![column] = value
    expect(() => parse(seed)).toThrow(new RegExp(`${table}\\[0\\][\\s\\S]*${column}`))
  })

  it('refuses a provider the default seed lacks', () => {
    const seed = heroSeed()
    const settings = seed.stories![0]!.settings as Row
    settings.models = { classifier: { providerId: 'prov_dev', modelId: 'Gemma4' } }
    expect(() => parse(seed)).toThrow(/prov_dev/)
    settings.models = {}
    settings.embedding_provider_id = 'prov_mock'
    expect(() => parse(seed)).toThrow(/prov_mock/)
    settings.embedding_provider_id = 'prov_local'
    settings.embedding_swap_provider_id = 'prov_swap'
    expect(() => parse(seed)).toThrow(/prov_swap/)
  })

  it('refuses a table it does not seed, and a missing one', () => {
    const extra = heroSeed()
    extra.pipeline_runs = []
    expect(() => parse(extra)).toThrow(/pipeline_runs/)
    const missing = heroSeed()
    delete missing.lore
    expect(() => parse(missing)).toThrow(/lore/)
  })

  it('refuses a current branch outside the story, and takes none', () => {
    const seed = heroSeed()
    seed.stories![0]!.currentBranchId = 'br_rich_main'
    expect(() => parse(seed)).toThrow(/stories\[0\][\s\S]*br_rich_main/)
    seed.stories![0]!.currentBranchId = null
    expect(() => parse(seed)).not.toThrow()
  })

  it('refuses a row outside the story', () => {
    const twoStories = heroSeed()
    twoStories.stories!.push({ ...twoStories.stories![0]!, id: 'story_rich' })
    expect(() => parse(twoStories)).toThrow(/one story/)
    const foreignBranch = heroSeed()
    foreignBranch.branches![1]!.storyId = 'story_rich'
    expect(() => parse(foreignBranch)).toThrow(/branches\[1\]/)
    const foreignRow = heroSeed()
    foreignRow.deltas![7]!.branchId = 'br_rich_main'
    expect(() => parse(foreignRow)).toThrow(/deltas\[7\]/)
  })
})
