import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProviderInstanceWithStub } from '@/lib/ai'
import {
  branches,
  deltas,
  emptyCastDraft,
  emptyEntityState,
  emptyWorkingState,
  entities,
  entityStateSchemaForKind,
  lore,
  stories,
  storyEntries,
  wizardSessions,
  type SqlOp,
  type WizardCastDraft,
  type WizardCharacterDraft,
  type WizardLoreDraft,
  type WizardWorkingState,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { EmbedderCallError, EmbedderInitError } from '@/lib/embedder'
import { navigationStore, storiesStore } from '@/lib/stores'

import { finishWizard, type FinishAppDefaults, type FinishEmbedCtx } from './finish'

// Stub only the embed helper (reached through createStoryWithBranch); the gate
// resolver stays real so the precheck branches exercise genuine logic.
vi.mock('@/lib/embedder', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, embedAndBuildVecOps: vi.fn() }
})

const { embedAndBuildVecOps } = await import('@/lib/embedder')
const mockedEmbed = vi.mocked(embedAndBuildVecOps)

const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2'

// A usable local embedder (installed) so the hard gate lets Finish through.
const APP_DEFAULTS: FinishAppDefaults = {
  defaultStorySettings: {},
  embeddingModelId: LOCAL_MODEL,
  embeddingProviderId: null,
  defaultSuggestionCategories: { adventure: [], creative: [] },
  providers: [],
  installedLocalIds: [LOCAL_MODEL],
}

const EMBED_CTX: FinishEmbedCtx = {
  exec: async () => {},
  resolveProvider: () => undefined,
}

const PROVIDER_MODEL = 'text-embedding-3-large'

// Provider backend on a Matryoshka-capable model — the only shape where an
// effectiveDim is applicable and threaded into committed settings.
const MATRYOSHKA_PROVIDER_DEFAULTS: FinishAppDefaults = {
  defaultStorySettings: { embeddingBackend: 'provider' },
  embeddingModelId: PROVIDER_MODEL,
  embeddingProviderId: 'p1',
  defaultSuggestionCategories: { adventure: [], creative: [] },
  providers: [
    {
      id: 'p1',
      type: 'openai-compatible',
      displayName: 'P1',
      apiKey: 'k',
      favoriteModelIds: [],
      endpoint: 'http://localhost:1234/v1',
      cachedModels: [
        {
          id: PROVIDER_MODEL,
          capabilities: { matryoshkaSupported: true, matryoshkaDims: [512, 1024, 2048] },
        },
      ],
    },
  ],
  installedLocalIds: [],
}

// Same provider/backend but the model no longer declares Matryoshka support —
// a mid-session app-default swap; the stale dim must be dropped to native.
const NON_MATRYOSHKA_PROVIDER_DEFAULTS: FinishAppDefaults = {
  ...MATRYOSHKA_PROVIDER_DEFAULTS,
  providers: [
    {
      ...MATRYOSHKA_PROVIDER_DEFAULTS.providers[0],
      cachedModels: [{ id: PROVIDER_MODEL, capabilities: { matryoshkaSupported: false } }],
    },
  ],
}

const LEAD_ID = 'char_11111111-1111-1111-1111-111111111111'
const LOCATION_ID = 'loc_33333333-3333-3333-3333-333333333333'
const FACTION_ID = 'fact_44444444-4444-4444-4444-444444444444'
const ITEM_ID = 'item_55555555-5555-5555-5555-555555555555'

/** The post-3.6b lead: an active character row in `cast`, starred by leadEntityId. */
function leadCast(name = 'Aria', id = LEAD_ID): WizardCharacterDraft {
  return { ...emptyCastDraft('character', id), name }
}

function loreRow(overrides: Partial<WizardLoreDraft> = {}): WizardLoreDraft {
  return {
    id: 'lore_11111111-1111-1111-1111-111111111111',
    title: 'The Salt Wells',
    body: 'Nine wells ring the drowned coast.',
    category: '',
    tags: [],
    injectionMode: 'auto',
    priority: 0,
    ...overrides,
  }
}

type MakeStateInput = {
  mode?: WizardWorkingState['definition']['mode']
  narration?: WizardWorkingState['definition']['narration']
  title?: string
  description?: string
  genre?: WizardWorkingState['definition']['genre']
  tone?: WizardWorkingState['definition']['tone']
  setting?: string
  leadEntityId?: string | null
  cast?: WizardCastDraft[]
  opening?: Partial<WizardWorkingState['opening']>
  effectiveDim?: number | null
  lore?: WizardLoreDraft[]
}

function makeState(input: MakeStateInput = {}): WizardWorkingState {
  const base = emptyWorkingState()
  return {
    ...base,
    step: 5,
    leadEntityId: input.leadEntityId ?? base.leadEntityId,
    effectiveDim: input.effectiveDim ?? base.effectiveDim,
    definition: {
      ...base.definition,
      mode: input.mode ?? base.definition.mode,
      narration: input.narration ?? base.definition.narration,
      title: input.title ?? base.definition.title,
      description: input.description ?? base.definition.description,
      genre: input.genre ?? base.definition.genre,
      tone: input.tone ?? base.definition.tone,
      setting: input.setting ?? base.definition.setting,
    },
    opening: { ...base.opening, ...input.opening },
    lore: input.lore ?? base.lore,
    cast: input.cast ?? base.cast,
  }
}

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  storiesStore.__reset()
  navigationStore.__reset()
  return { db, ctx: { db, runInTransaction } }
}

beforeEach(() => {
  mockedEmbed.mockReset()
  mockedEmbed.mockResolvedValue([])
})

describe('finishWizard', () => {
  it('creative+third: commits story+branch+opening with zero deltas and navigates', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()

    const result = await finishWizard(
      makeState({ title: 'The Floating Isles', opening: { content: 'Once upon a time.' } }),
      ctx,
      navigate,
      APP_DEFAULTS,
      EMBED_CTX,
      1000,
    )

    expect(result).toEqual({ status: 'ok', storyId: expect.any(String) })
    const storyId = result.status === 'ok' ? result.storyId : ''

    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.status).toBe('active')

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    expect(branchRows).toHaveLength(1)
    expect(storyRow.currentBranchId).toBe(branchRows[0].id)

    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows).toHaveLength(1)
    expect(entryRows[0]).toMatchObject({
      position: 1,
      kind: 'opening',
      content: 'Once upon a time.',
    })
    expect(entryRows[0].metadata!.model).toBeUndefined()
    expect(entryRows[0].metadata!.sceneEntities).toEqual([])

    expect(await db.select().from(entities)).toHaveLength(0)
    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(navigate).toHaveBeenCalledWith(branchRows[0].id)
  })

  it('commits the authored genre, tone, and setting into stories.definition', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({
        title: 'World-shaped',
        opening: { content: 'Once.' },
        genre: { label: 'Grimdark fantasy', promptBody: 'Write it bleak and violent.' },
        tone: { label: 'Wry', promptBody: 'Keep a dry, understated register.' },
        setting: 'A drowned coastal empire in slow collapse.',
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      1500,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.definition!.genre).toEqual({
      label: 'Grimdark fantasy',
      promptBody: 'Write it bleak and violent.',
    })
    expect(storyRow.definition!.tone).toEqual({
      label: 'Wry',
      promptBody: 'Keep a dry, understated register.',
    })
    expect(storyRow.definition!.setting).toBe('A drowned coastal empire in slow collapse.')
  })

  it('adventure+first: writes the lead entity, definition.leadEntityId, and opening refs to one id', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Aria Rising',
        leadEntityId: LEAD_ID,
        cast: [leadCast()],
        opening: {
          content: 'You wake at dawn.',
          sceneEntities: [LEAD_ID],
          currentLocationId: 'loc_99999999-9999-9999-9999-999999999999',
          model: 'gpt-x',
        },
      }),
      ctx,
      navigate,
      APP_DEFAULTS,
      EMBED_CTX,
      2000,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''

    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.definition!.leadEntityId).toBe(LEAD_ID)

    const entityRows = await db.select().from(entities)
    expect(entityRows).toHaveLength(1)
    expect(entityRows[0]).toMatchObject({
      id: LEAD_ID,
      kind: 'character',
      name: 'Aria',
      status: 'active',
    })
    expect(entityRows[0].state).toEqual(emptyEntityState('character'))

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.sceneEntities).toEqual([LEAD_ID])
    expect(entryRows[0].metadata!.model).toBe('gpt-x')
    // The opening carried a location id that no cast row materializes — it must
    // not commit as a ref to a row that will never exist.
    expect(entryRows[0].metadata!.currentLocationId).toBeNull()

    // The load-bearing id-consistency invariant: the committed opening ref, the
    // lead entities row, and definition.leadEntityId are all the SAME real id.
    expect(entityRows[0].id).toBe(entryRows[0].metadata!.sceneEntities[0])
    expect(entityRows[0].id).toBe(storyRow.definition!.leadEntityId)

    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(navigate).toHaveBeenCalledWith(branchRows[0].id)
  })

  it('never mints a lead: a lead-requiring path with an unstarred cast character blocks', async () => {
    const { db, ctx } = await setup()

    // The character exists in cast but nothing ⭐-starred it. The star IS the
    // lead, so an unresolved pointer must block rather than invent a second
    // character.
    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Untold',
        leadEntityId: null,
        cast: [leadCast('Bran')],
        opening: { content: 'The gate opened.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      2500,
    )

    expect(result).toEqual({ status: 'invalid', reasons: ['lead'] })
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(entities)).toHaveLength(0)
  })

  it('a staged character cannot hold the lead: Finish blocks on the lead reason', async () => {
    const { db, ctx } = await setup()

    // setCastStatus cascades the lead off when a row is staged in-session, but a
    // hydrated draft can carry the stale pointer past it (wizard.md → Status field).
    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Not Yet On Stage',
        leadEntityId: LEAD_ID,
        cast: [{ ...leadCast(), status: 'staged' }],
        opening: { content: 'The gate opened.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      2600,
    )

    expect(result).toEqual({ status: 'invalid', reasons: ['lead'] })
    expect(await db.select().from(stories)).toHaveLength(0)
  })

  it('drops opening refs pointing at rows the commit never materializes', async () => {
    const { db, ctx } = await setup()

    // creative+third with an empty cast, but the opening carries a ref minted on
    // an earlier pass — the commit must not persist a dangling entity ref, and
    // the unresolvable leadEntityId must not reach stories.definition.
    const result = await finishWizard(
      makeState({
        title: 'Reframed',
        leadEntityId: LEAD_ID,
        opening: { content: 'Once.', sceneEntities: [LEAD_ID], model: 'gpt-x' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      4500,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.definition!.leadEntityId).toBeNull()
    expect(await db.select().from(entities)).toHaveLength(0)

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.sceneEntities).toEqual([])
  })

  it('maps each cast kind onto its authored EntityState, leaving classifier slots empty', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Mixed Cast',
        leadEntityId: LEAD_ID,
        cast: [
          {
            ...leadCast(),
            description: '  ',
            tags: ['protagonist'],
            voice: 'Clipped, salt-dry.',
            traits: ['wary'],
            drives: ['find the wells'],
            visual: {
              physique: 'wiry',
              face: '',
              hair: '   ',
              eyes: 'grey',
              attire: '',
              distinguishing: '',
            },
            factionId: FACTION_ID,
          },
          {
            ...emptyCastDraft('location', LOCATION_ID),
            name: 'The Salt Wells',
            description: 'Nine wells ring the coast.',
            condition: 'drowned',
          },
          { ...emptyCastDraft('item', ITEM_ID), name: 'Tide Charter', condition: '  ' },
          {
            ...emptyCastDraft('faction', FACTION_ID),
            name: 'The Charterhouse',
            standing: 'feared',
            agenda: ['keep the wells'],
          },
        ],
        opening: { content: 'You wake at dawn.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      2700,
    )

    expect(result.status).toBe('ok')
    const entityRows = await db.select().from(entities)
    expect(entityRows).toHaveLength(4)

    const lead = entityRows.find((r) => r.id === LEAD_ID)
    // A blank description commits as NULL, not ''; tags ride along verbatim.
    expect(lead).toMatchObject({ kind: 'character', name: 'Aria', description: null })
    expect(lead?.tags).toEqual(['protagonist'])
    // Authorship contract: wizard-authored identity seeds the state, blank
    // sub-fields are absent rather than '', and every classifier-owned slot
    // (current_location_id / equipped_items / inventory / lastSeenAt) is empty.
    expect(lead?.state).toEqual({
      visual: { physique: 'wiry', eyes: 'grey' },
      traits: ['wary'],
      drives: ['find the wells'],
      voice: 'Clipped, salt-dry.',
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      faction_id: FACTION_ID,
      lastSeenAt: null,
    })

    expect(entityRows.find((r) => r.id === LOCATION_ID)?.state).toEqual({
      parent_location_id: null,
      condition: 'drowned',
    })
    // Blank condition is omitted, and at_location_id is classifier-owned.
    expect(entityRows.find((r) => r.id === ITEM_ID)?.state).toEqual({ at_location_id: null })
    expect(entityRows.find((r) => r.id === FACTION_ID)?.state).toEqual({
      standing: 'feared',
      agenda: ['keep the wells'],
    })

    // castDraftState is the ONLY thing between a draft and a raw insert —
    // create-story runs no schema on the way in. Assert against the real
    // per-kind schema, so a mapping that pairs the wrong shape with a kind, or
    // a string past its degradation bound, fails here rather than in the DB.
    for (const row of entityRows) {
      const parsed = entityStateSchemaForKind(row.kind).safeParse(row.state)
      expect(parsed.success, `${row.kind} state must satisfy its own schema`).toBe(true)
    }
  })

  it('re-guards intra-cast refs whose target row is gone by the time Finish runs', async () => {
    const { db, ctx } = await setup()

    // The store prunes factionId / parentLocationId on removeCast; this is the
    // backstop for a working state that reached step 5 some other way.
    const result = await finishWizard(
      makeState({
        title: 'Orphaned Refs',
        cast: [
          { ...leadCast(), factionId: FACTION_ID },
          {
            ...emptyCastDraft('location', LOCATION_ID),
            name: 'The Salt Wells',
            parentLocationId: 'loc_66666666-6666-6666-6666-666666666666',
          },
        ],
        opening: { content: 'Once.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      2800,
    )

    expect(result.status).toBe('ok')
    const entityRows = await db.select().from(entities)
    expect(entityRows.find((r) => r.id === LEAD_ID)?.state).toMatchObject({ faction_id: null })
    expect(entityRows.find((r) => r.id === LOCATION_ID)?.state).toEqual({
      parent_location_id: null,
    })
  })

  it('drops a location that names itself as its own parent', async () => {
    const { db, ctx } = await setup()

    // Reachable through ✨ Suggest cast, not just a corrupt blob:
    // resolveCastImports indexes every minted row's own name before resolving
    // refs, so a suggested location whose parent_location_name is its own name
    // binds to itself. The editor's candidate list excludes self; the import
    // path does not.
    const result = await finishWizard(
      makeState({
        title: 'Self-Parented',
        cast: [
          {
            ...emptyCastDraft('location', LOCATION_ID),
            name: 'The Salt Wells',
            parentLocationId: LOCATION_ID,
          },
        ],
        opening: { content: 'Once.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      2850,
    )

    expect(result.status).toBe('ok')
    const entityRows = await db.select().from(entities)
    expect(entityRows.find((r) => r.id === LOCATION_ID)?.state).toEqual({
      parent_location_id: null,
    })
  })

  it('embeds every cast row and the lore rows in ONE call, cast first', async () => {
    const { ctx } = await setup()
    const row = loreRow({ title: 'Magic', body: 'Wells.' })

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'One Call',
        leadEntityId: LEAD_ID,
        cast: [
          { ...leadCast(), description: 'A tide-reader.' },
          { ...emptyCastDraft('location', LOCATION_ID), name: 'The Salt Wells', status: 'staged' },
        ],
        lore: [row],
        opening: { content: 'You wake.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      2900,
    )

    expect(result.status).toBe('ok')
    // Contract C5 — one batched call for the whole commit, never one per row or
    // one per collection; the full array pins the order too.
    expect(mockedEmbed).toHaveBeenCalledTimes(1)
    expect(mockedEmbed.mock.calls[0][1]).toEqual([
      {
        kind: 'entity',
        id: LEAD_ID,
        branchId: expect.any(String),
        fields: ['Aria', 'A tide-reader.'],
      },
      {
        kind: 'entity',
        id: LOCATION_ID,
        branchId: expect.any(String),
        fields: ['The Salt Wells', null],
      },
      { kind: 'lore', id: row.id, branchId: expect.any(String), fields: ['Magic', 'Wells.'] },
    ])
  })

  it('opening refs: keeps active ids, drops staged ones and unknown ids', async () => {
    const { db, ctx } = await setup()
    const unknownId = 'char_77777777-7777-7777-7777-777777777777'
    const activeItemId = 'item_66666666-6666-6666-6666-666666666666'

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Scene Metadata',
        leadEntityId: LEAD_ID,
        cast: [
          leadCast(),
          { ...emptyCastDraft('item', activeItemId), name: 'Tide Charter' },
          { ...emptyCastDraft('location', LOCATION_ID), name: 'The Salt Wells' },
          { ...emptyCastDraft('item', ITEM_ID), name: 'Salt Lantern', status: 'staged' },
        ],
        opening: {
          content: 'You wake at dawn.',
          // Staged rows can't appear in scene metadata (canon); the unknown id is
          // a model hallucination that survived reverse-substitution.
          sceneEntities: [LEAD_ID, activeItemId, ITEM_ID, unknownId],
          currentLocationId: LOCATION_ID,
          model: 'gpt-x',
        },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      3100,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    // Characters and items only, in the order the model gave them.
    expect(entryRows[0].metadata!.sceneEntities).toEqual([LEAD_ID, activeItemId])
    // An active location the commit materializes now rides into the opening.
    expect(entryRows[0].metadata!.currentLocationId).toBe(LOCATION_ID)
  })

  it('drops an active faction or location from sceneEntities: scene presence is kind-aware', async () => {
    const { db, ctx } = await setup()

    // data-model.md → Scene presence is kind-aware: sceneEntities carries the
    // characters and items that come and go, never a faction or a location.
    // Reachable, not theoretical — the opening macro lists every active cast row
    // as a referenceable id and openingOutputSchema.sceneEntities is a bare
    // string array with no enum. And it is not cosmetic: an entity in
    // sceneEntities is ALWAYS injected regardless of injection_mode, and the
    // per-turn classifier promotes staged rows that appear there.
    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Kind-Aware Scene Tags',
        leadEntityId: LEAD_ID,
        cast: [
          leadCast(),
          { ...emptyCastDraft('faction', FACTION_ID), name: 'The Charterhouse' },
          { ...emptyCastDraft('location', LOCATION_ID), name: 'The Salt Wells' },
        ],
        opening: {
          content: 'You wake at dawn.',
          sceneEntities: [LEAD_ID, FACTION_ID, LOCATION_ID],
          currentLocationId: LOCATION_ID,
          model: 'gpt-x',
        },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      3150,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.sceneEntities).toEqual([LEAD_ID])
    // The location still belongs in its own slot — dropping it from
    // sceneEntities is a field rule, not a "this row isn't in the scene" rule.
    expect(entryRows[0].metadata!.currentLocationId).toBe(LOCATION_ID)
    // Both rows still commit; only the scene tag is filtered.
    expect(await db.select().from(entities)).toHaveLength(3)
  })

  it('drops a currentLocationId pointing at a row that is not a location', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({
        title: 'Wrong Kind Ref',
        cast: [leadCast(), { ...emptyCastDraft('location', LOCATION_ID), name: 'The Salt Wells' }],
        // A character id in the location slot: resolveOpening's reverse
        // substitution never checks kind, so the guard has to.
        opening: { content: 'Once.', currentLocationId: LEAD_ID, model: 'gpt-x' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      3200,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.currentLocationId).toBeNull()
  })

  it('drops a currentLocationId pointing at a staged location', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({
        title: 'Staged Location Ref',
        // The location IS materialized by this commit, so a dangling-ref check
        // alone would let it through — wizard.md → Status field keeps staged
        // entities out of scene metadata, and currentLocationId is part of it.
        cast: [
          { ...emptyCastDraft('location', LOCATION_ID), name: 'The Salt Wells', status: 'staged' },
        ],
        opening: { content: 'Once.', currentLocationId: LOCATION_ID, model: 'gpt-x' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      3250,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.currentLocationId).toBeNull()
    // The row itself still commits — staged is a scene-metadata rule, not a
    // "don't create it" rule.
    expect(await db.select().from(entities)).toHaveLength(1)
  })

  it('a one-click lead reassignment leaves the ex-lead in sceneEntities: still an active row', async () => {
    const { db, ctx } = await setup()
    const newLeadId = 'char_88888888-8888-8888-8888-888888888888'

    // wizard.md → Compact row presentation: `⭐ Set as lead` moves the lead in one
    // click and deliberately does NOT rewrite the opening's sceneEntities. That
    // is only safe because the ex-lead is still an ACTIVE cast row, so this
    // commit materializes it and the ref resolves — pinned here because the
    // active-row filter is what makes the decision safe.
    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Reassigned',
        leadEntityId: newLeadId,
        cast: [leadCast(), leadCast('Kade', newLeadId)],
        opening: { content: 'You wake at dawn.', sceneEntities: [LEAD_ID], model: 'gpt-x' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      3300,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.definition!.leadEntityId).toBe(newLeadId)

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.sceneEntities).toEqual([LEAD_ID])
  })

  it('creative+third commits a starred lead even though the path does not require one', async () => {
    const { db, ctx } = await setup()

    // Deliberate: `⭐ Set as lead` gates on canSetLead (kind + status), not on
    // needsLead, so a creative-mode author can star a character and Finish must
    // honor it. storyDefinitionSchema permits a lead on a lead-less path, and
    // definition.leadEntityId feeds the opening prompt's lead line.
    const result = await finishWizard(
      makeState({
        title: 'Creative With A Lead',
        leadEntityId: LEAD_ID,
        cast: [leadCast()],
        opening: { content: 'Once.', sceneEntities: [LEAD_ID], model: 'gpt-x' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      3350,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.definition!.mode).toBe('creative')
    expect(storyRow.definition!.leadEntityId).toBe(LEAD_ID)

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.sceneEntities).toEqual([LEAD_ID])
  })

  it('blocks Finish when a cast row carries an empty name; DB untouched', async () => {
    const { db, ctx } = await setup()

    // Same persistence hole as the lore re-check below: hydrate() sets
    // furthestStep = state.step with no re-validation, so a draft resumed at
    // step 5 never passed step 4's gate.
    const result = await finishWizard(
      makeState({
        title: 'A title',
        opening: { content: 'Once.' },
        cast: [{ ...emptyCastDraft('location', LOCATION_ID), name: '   ' }],
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      3400,
    )

    expect(result).toEqual({ status: 'invalid', reasons: ['cast'] })
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(entities)).toHaveLength(0)
  })

  it('rejects a dirty cast row before the embedder gate runs, even with no usable embedder', async () => {
    const { ctx } = await setup()
    const execd: string[] = []

    const result = await finishWizard(
      makeState({
        title: 'A title',
        opening: { content: 'Once.' },
        cast: [{ ...leadCast(''), status: 'staged' }],
      }),
      ctx,
      vi.fn(),
      // Deliberately unusable embedder: if the gate ran before the cast check,
      // this would surface as embed-blocked instead of invalid/cast.
      { ...APP_DEFAULTS, embeddingModelId: null, installedLocalIds: [] },
      { exec: async (sql) => void execd.push(sql), resolveProvider: () => undefined },
      3500,
    )

    expect(result).toEqual({ status: 'invalid', reasons: ['cast'] })
    expect(mockedEmbed).not.toHaveBeenCalled()
    expect(execd).toHaveLength(0)
  })

  it('threads a chosen effectiveDim into stories.settings.effectiveDim', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({ title: 'Truncated', opening: { content: 'Once.' }, effectiveDim: 1024 }),
      ctx,
      vi.fn(),
      MATRYOSHKA_PROVIDER_DEFAULTS,
      EMBED_CTX,
      6000,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.settings!.effectiveDim).toBe(1024)
  })

  it('drops a working-state dim above the probed model native dim to native', async () => {
    const { db, ctx } = await setup()
    // The app default moved to a model with a smaller native dim after the pick
    // was made; the disclosure is collapsed by default, so nothing on screen
    // would have corrected it before Finish.
    const probedDefaults: FinishAppDefaults = {
      ...MATRYOSHKA_PROVIDER_DEFAULTS,
      providers: [
        {
          ...MATRYOSHKA_PROVIDER_DEFAULTS.providers[0],
          cachedModels: [
            {
              id: PROVIDER_MODEL,
              capabilities: {
                matryoshkaSupported: true,
                matryoshkaDims: [512, 1024],
                embeddingDim: 1536,
              },
            },
          ],
        },
      ],
    }

    const result = await finishWizard(
      makeState({ title: 'Oversized', opening: { content: 'Once.' }, effectiveDim: 4096 }),
      ctx,
      vi.fn(),
      probedDefaults,
      EMBED_CTX,
      6050,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    // Storing 4096 would misdescribe vectors the embedder can only make 1536 long.
    expect(storyRow.settings!.effectiveDim).toBeUndefined()
  })

  it('embeds the lead with the committed effectiveDim, not the native-dim gate config', async () => {
    const { ctx } = await setup()

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Truncated Lead',
        leadEntityId: LEAD_ID,
        cast: [leadCast()],
        opening: { content: 'Once.', sceneEntities: [LEAD_ID] },
        effectiveDim: 512,
      }),
      ctx,
      vi.fn(),
      MATRYOSHKA_PROVIDER_DEFAULTS,
      EMBED_CTX,
      6100,
    )

    expect(result.status).toBe('ok')
    expect(mockedEmbed).toHaveBeenCalledTimes(1)
    // The gate resolves with no story, so its config truncates nothing — the
    // lead's vector would land in a dim family the story never queries again.
    expect(mockedEmbed.mock.calls[0][0]).toMatchObject({
      backend: 'provider',
      truncation: { effectiveDim: 512, serverSide: true },
    })
  })

  it('drops a stale effectiveDim when the app default model is not Matryoshka', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({ title: 'Swapped', opening: { content: 'Once.' }, effectiveDim: 1024 }),
      ctx,
      vi.fn(),
      NON_MATRYOSHKA_PROVIDER_DEFAULTS,
      EMBED_CTX,
      6200,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.settings!.effectiveDim).toBeUndefined()
  })

  it('leaves effectiveDim absent (native dim) when the working state is null', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({ title: 'Native', opening: { content: 'Once.' } }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      6500,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.settings!.effectiveDim).toBeUndefined()
  })

  it('blocks Finish when an applicable stored effectiveDim is non-positive; DB untouched', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({ title: 'Corrupt', opening: { content: 'Once.' }, effectiveDim: 0 }),
      ctx,
      vi.fn(),
      MATRYOSHKA_PROVIDER_DEFAULTS,
      EMBED_CTX,
      7000,
    )

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reasons).toContain('effectiveDim')
    expect(await db.select().from(stories)).toHaveLength(0)
  })

  it('blocks Finish when the title is empty; DB untouched, no navigation', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()

    const result = await finishWizard(
      makeState({ title: '   ', opening: { content: 'Once.' } }),
      ctx,
      navigate,
      APP_DEFAULTS,
      EMBED_CTX,
      3000,
    )

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reasons).toContain('title')
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(branches)).toHaveLength(0)
    expect(await db.select().from(storyEntries)).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('blocks Finish when the opening is empty; DB untouched', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({ title: 'A title', opening: { content: '' } }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      3500,
    )

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reasons).toContain('opening')
    expect(await db.select().from(stories)).toHaveLength(0)
  })

  it('blocks Finish when a lead is required but the cast holds none', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'A title',
        opening: { content: 'Once.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      4000,
    )

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reasons).toContain('lead')
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(entities)).toHaveLength(0)
  })

  it('blocks Finish when a lore row carries an empty title or body; DB untouched', async () => {
    const { db, ctx } = await setup()

    // Reachable via the persistence round-trip, not in-session nav: hydrate()
    // sets furthestStep = state.step with no re-validation, so a persisted
    // draft resumed at step 5 can carry a dirty row step 3's gate never saw.
    const result = await finishWizard(
      makeState({
        title: 'A title',
        opening: { content: 'Once.' },
        lore: [loreRow({ body: '' })],
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      4200,
    )

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reasons).toContain('lore')
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(lore)).toHaveLength(0)
  })

  it('rejects dirty lore before the embedder gate runs, even with no usable embedder', async () => {
    const { ctx } = await setup()
    const execd: string[] = []

    const result = await finishWizard(
      makeState({
        title: 'A title',
        opening: { content: 'Once.' },
        lore: [loreRow({ title: '   ' })],
      }),
      ctx,
      vi.fn(),
      // Deliberately unusable embedder: if the gate ran before the lore check,
      // this would surface as embed-blocked instead of invalid/lore.
      { ...APP_DEFAULTS, embeddingModelId: null, installedLocalIds: [] },
      { exec: async (sql) => void execd.push(sql), resolveProvider: () => undefined },
      4250,
    )

    expect(result).toEqual({ status: 'invalid', reasons: ['lore'] })
    expect(mockedEmbed).not.toHaveBeenCalled()
    expect(execd).toHaveLength(0)
  })

  it('commits clean lore rows into the lore table', async () => {
    const { db, ctx } = await setup()
    const row = loreRow({ category: 'Geography', tags: ['coast'] })

    const result = await finishWizard(
      makeState({ title: 'World-building', opening: { content: 'Once.' }, lore: [row] }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      4300,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const loreRows = await db.select().from(lore).where(eq(lore.branchId, branchRows[0].id))
    expect(loreRows).toHaveLength(1)
    expect(loreRows[0]).toMatchObject({
      id: row.id,
      title: row.title,
      body: row.body,
      category: 'Geography',
    })
    expect(loreRows[0].tags).toEqual(['coast'])
  })

  it('promoteDraftStoryId: a resumed draft is promoted in place, its session row is gone', async () => {
    const { db, ctx } = await setup()
    const draftId = 'story_draft_resumed'
    const navigate = vi.fn()

    await db.insert(stories).values({
      id: draftId,
      title: 'Untitled story',
      status: 'draft',
      createdAt: 100,
      updatedAt: 100,
    })
    await db
      .insert(wizardSessions)
      .values({ id: draftId, storyId: draftId, state: emptyWorkingState(), updatedAt: 100 })

    const result = await finishWizard(
      makeState({ title: 'Promoted', opening: { content: 'The draft becomes real.' } }),
      ctx,
      navigate,
      APP_DEFAULTS,
      EMBED_CTX,
      5000,
      draftId,
    )

    expect(result).toEqual({ status: 'ok', storyId: draftId })

    const storyRow = (await db.select().from(stories).where(eq(stories.id, draftId)))[0]
    expect(storyRow.status).toBe('active')
    expect(storyRow.title).toBe('Promoted')

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, draftId))
    expect(branchRows).toHaveLength(1)
    expect(storyRow.currentBranchId).toBe(branchRows[0].id)

    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows).toHaveLength(1)
    expect(entryRows[0].content).toBe('The draft becomes real.')

    const sessionRows = await db.select().from(wizardSessions).where(eq(wizardSessions.id, draftId))
    expect(sessionRows).toHaveLength(0)

    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(navigate).toHaveBeenCalledWith(branchRows[0].id)
  })

  it('still navigates and returns ok when clearing the live session fails post-commit', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()
    await db
      .insert(wizardSessions)
      .values({ id: 'live', storyId: null, state: emptyWorkingState(), updatedAt: 1 })

    // Fail only the live-session clear — its lone single-op wizard_sessions
    // delete. The story commit (multi-op) and the open must still go through.
    const failingCtx = {
      ...ctx,
      runInTransaction: (ops: SqlOp[]) =>
        ops.length === 1 && /wizard_sessions/.test(ops[0].sql)
          ? Promise.reject(new Error('clear failed'))
          : ctx.runInTransaction(ops),
    }

    const result = await finishWizard(
      makeState({ title: 'Survives', opening: { content: 'Committed anyway.' } }),
      failingCtx,
      navigate,
      APP_DEFAULTS,
      EMBED_CTX,
      1000,
    )

    expect(result).toEqual({ status: 'ok', storyId: expect.any(String) })
    expect(navigate).toHaveBeenCalledTimes(1)

    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.status).toBe('active')
    // Cleanup threw, so the live row is intentionally left behind.
    const liveRows = await db.select().from(wizardSessions).where(eq(wizardSessions.id, 'live'))
    expect(liveRows).toHaveLength(1)
  })
})

describe('finishWizard — embedder hard gate', () => {
  it('blocks with the gate reason and never commits when no embedder is usable', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()

    const result = await finishWizard(
      makeState({ title: 'Gated', opening: { content: 'Once.' } }),
      ctx,
      navigate,
      { ...APP_DEFAULTS, embeddingModelId: null, installedLocalIds: [] },
      EMBED_CTX,
      1000,
    )

    expect(result).toEqual({ status: 'embed-blocked', reason: 'no-model', backend: 'local' })
    expect(mockedEmbed).not.toHaveBeenCalled()
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('surfaces embed-failed (init) and rolls back when the embed throws EmbedderInitError', async () => {
    const { db, ctx } = await setup()
    mockedEmbed.mockRejectedValue(new EmbedderInitError('session never came up'))

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Doomed',
        leadEntityId: LEAD_ID,
        cast: [leadCast()],
        opening: { content: 'You wake.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      2000,
    )

    expect(result).toEqual({
      status: 'embed-failed',
      kind: 'init',
      message: 'session never came up',
    })
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(entities)).toHaveLength(0)
  })

  it('surfaces embed-failed (call) when the embed throws EmbedderCallError', async () => {
    const { ctx } = await setup()
    mockedEmbed.mockRejectedValue(new EmbedderCallError('vec table ensure failed'))

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Doomed',
        leadEntityId: LEAD_ID,
        cast: [leadCast()],
        opening: { content: 'You wake.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      EMBED_CTX,
      2000,
    )

    expect(result).toEqual({
      status: 'embed-failed',
      kind: 'call',
      message: 'vec table ensure failed',
    })
  })

  it('provider backend: passes the caller-resolved provider through to the embed helper', async () => {
    const { ctx } = await setup()
    const provider = { id: 'p1' } as unknown as ProviderInstanceWithStub
    const embedCtx: FinishEmbedCtx = {
      exec: async () => {},
      resolveProvider: vi.fn(() => provider),
    }

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Provider',
        leadEntityId: LEAD_ID,
        cast: [leadCast()],
        opening: { content: 'You wake.' },
      }),
      ctx,
      vi.fn(),
      {
        ...APP_DEFAULTS,
        defaultStorySettings: { embeddingBackend: 'provider' },
        embeddingModelId: 'text-embedding-3-small',
        embeddingProviderId: 'p1',
        providers: [
          {
            id: 'p1',
            type: 'openai-compatible',
            displayName: 'P1',
            apiKey: 'k',
            favoriteModelIds: [],
            endpoint: 'http://localhost:1234/v1',
          },
        ],
        installedLocalIds: [],
      },
      embedCtx,
      2000,
    )

    expect(result.status).toBe('ok')
    expect(embedCtx.resolveProvider).toHaveBeenCalledWith('p1')
    expect(mockedEmbed).toHaveBeenCalledTimes(1)
    expect(mockedEmbed.mock.calls[0][3]).toBe(provider)
  })
})
