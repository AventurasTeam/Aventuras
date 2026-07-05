import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { loadDraft, saveStoryDraft } from '@/lib/actions'
import { parseStructured } from '@/lib/ai'
import {
  branches,
  deltas,
  emptyWorkingState,
  entities,
  stories,
  storyEntries,
  wizardSessions,
  type WizardWorkingState,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { generateId, IdBiMap, parseAndSubstitute } from '@/lib/ids'
import { navigationStore, storiesStore } from '@/lib/stores'
import { openingOutputSchema } from '@/lib/wizard'

import { finishWizard } from './finish'

// Consolidated full-flow integration test for Slice M2.3. Each unit (finish.ts,
// createStoryWithBranch, session/draft actions, the structured-output parse
// path, IdBiMap/substitution) already has its own suite — this file proves the
// SEAMS between them: a real UUID minted in the wizard survives a placeholder
// round-trip through simulated model output and lands in the committed row,
// and a draft's full working-state survives a save/load/promote cycle. No
// live provider call anywhere; "AI output" is a literal fixture string fed
// through the same parseStructured/parseAndSubstitute path the real call uses.

const APP_DEFAULTS = { defaultStorySettings: {}, embeddingModelId: null }

type MakeStateInput = {
  mode?: WizardWorkingState['definition']['mode']
  narration?: WizardWorkingState['definition']['narration']
  title?: string
  leadName?: string
  leadEntityId?: string | null
  opening?: Partial<WizardWorkingState['opening']>
}

function makeState(input: MakeStateInput = {}): WizardWorkingState {
  const base = emptyWorkingState()
  return {
    ...base,
    step: 5,
    leadName: input.leadName ?? base.leadName,
    leadEntityId: input.leadEntityId ?? base.leadEntityId,
    definition: {
      ...base.definition,
      mode: input.mode ?? base.definition.mode,
      narration: input.narration ?? base.definition.narration,
      title: input.title ?? base.definition.title,
    },
    opening: { ...base.opening, ...input.opening },
  }
}

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  storiesStore.__reset()
  navigationStore.__reset()
  return { db, ctx: { db, runInTransaction } }
}

describe('wizard full-flow integration', () => {
  // AC1 — creative+third zero-delta commit to reader. finish.test.ts owns the
  // exhaustive per-field assertions; this is the concise end-to-end version
  // for the integration story.
  it('AC1: creative+third commits stories+branch+opening in one zero-delta transaction and navigates', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()

    const result = await finishWizard(
      makeState({ title: 'The Floating Isles', opening: { content: 'Once upon a time.' } }),
      ctx,
      navigate,
      APP_DEFAULTS,
      1000,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''

    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.status).toBe('active')

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    expect(branchRows).toHaveLength(1)

    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows).toHaveLength(1)

    expect(await db.select().from(entities)).toHaveLength(0)
    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(navigate).toHaveBeenCalledWith(branchRows[0].id)
  })

  // AC2 — adventure+first: the lead entity row, definition.leadEntityId, and
  // the opening ref all resolve to the SAME real (generated, not fixture-literal) UUID.
  it('AC2: adventure+first writes the lead entity, leadEntityId, and opening ref to one real UUID', async () => {
    const { db, ctx } = await setup()
    const leadId = generateId('char')

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Aria Rising',
        leadName: 'Aria',
        leadEntityId: leadId,
        opening: { content: 'You wake at dawn.', sceneEntities: [leadId], model: 'test-model' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      2000,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''

    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    const entityRows = await db.select().from(entities)
    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))

    expect(entityRows).toHaveLength(1)
    expect(entityRows[0].id).toBe(leadId)
    expect(storyRow.definition!.leadEntityId).toBe(leadId)
    expect(entryRows[0].metadata!.sceneEntities).toEqual([leadId])
  })

  describe('AC3: AI opening idMap round-trip (simulated model output, no live provider)', () => {
    it('substitutes a model-returned placeholder back to the real lead UUID and commits it end-to-end', async () => {
      const { db, ctx } = await setup()

      // Mint the lead's real id up front, exactly as the wizard does before an
      // opening-assist call on a lead-requiring path, and allocate it a
      // placeholder the way the prompt-build step does before calling the model.
      const leadId = generateId('char')
      const idMap = new IdBiMap()
      const placeholder = idMap.allocate(leadId)
      expect(placeholder).toBe('c1')

      // The model only ever sees the placeholder — this is a literal stand-in
      // for its structured-output response.
      const raw = `{"prose":"You wake at dawn, ${placeholder} at your side.","sceneEntities":["${placeholder}"],"currentLocationId":null,"worldTime":0}`
      const parsed = parseStructured(raw, openingOutputSchema)
      const resolvedSceneEntities = parseAndSubstitute(parsed.sceneEntities, idMap)
      expect(resolvedSceneEntities).toEqual([leadId])

      const result = await finishWizard(
        makeState({
          mode: 'adventure',
          narration: 'first',
          title: 'Dawn Patrol',
          leadName: 'Aria',
          leadEntityId: leadId,
          opening: {
            content: parsed.prose,
            sceneEntities: resolvedSceneEntities,
            model: 'test-model',
          },
        }),
        ctx,
        vi.fn(),
        APP_DEFAULTS,
        3000,
      )

      expect(result.status).toBe('ok')
      const storyId = result.status === 'ok' ? result.storyId : ''

      const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
      const entityRows = await db.select().from(entities)
      const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
      const entryRows = await db
        .select()
        .from(storyEntries)
        .where(eq(storyEntries.branchId, branchRows[0].id))

      // The load-bearing chain: committed opening ref === lead entities row id
      // === definition.leadEntityId === the one real UUID minted at the top.
      expect(entryRows[0].metadata!.sceneEntities[0]).toBe(leadId)
      expect(entityRows[0].id).toBe(leadId)
      expect(storyRow.definition!.leadEntityId).toBe(leadId)
    })

    it('recovers a jsonrepair-fixable opening fixture (trailing comma)', () => {
      const raw = '{"prose":"Hi","sceneEntities":["c1"],"currentLocationId":null,"worldTime":0,}'
      const parsed = parseStructured(raw, openingOutputSchema)
      expect(parsed.prose).toBe('Hi')
      expect(parsed.sceneEntities).toEqual(['c1'])
    })

    it('throws on a beyond-repair fixture; finishWizard still commits the fallback without blocking', async () => {
      expect(() => parseStructured('not json <<<', openingOutputSchema)).toThrow()

      const { db, ctx } = await setup()
      const result = await finishWizard(
        makeState({
          title: 'Fallback Tale',
          opening: { content: 'The gate opened.', sceneEntities: [], model: null },
        }),
        ctx,
        vi.fn(),
        APP_DEFAULTS,
        4000,
      )

      expect(result.status).toBe('ok')
      const storyId = result.status === 'ok' ? result.storyId : ''
      const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
      const entryRows = await db
        .select()
        .from(storyEntries)
        .where(eq(storyEntries.branchId, branchRows[0].id))

      expect(entryRows[0].metadata!.model).toBeUndefined()
      expect(entryRows[0].metadata!.sceneEntities).toEqual([])
    })
  })

  // AC4 — draft round-trip: every field populated across all 3 M2 steps
  // survives saveStoryDraft -> loadDraft, then finishWizard promotes the same
  // draft row to active with zero deltas and clears its wizard_sessions row.
  it('AC4: saveStoryDraft -> loadDraft round-trips all populated fields, then Finish promotes the draft in place', async () => {
    const { db, ctx } = await setup()
    const base = emptyWorkingState()

    const draftState: WizardWorkingState = {
      ...base,
      step: 5,
      definition: {
        ...base.definition,
        title: 'The Long Road',
        mode: 'adventure',
        narration: 'first',
        genre: { label: 'High fantasy', promptBody: 'Epic stakes, sweeping scale.' },
        tone: { label: 'Hopeful', promptBody: 'Warmth even in hardship.' },
        setting: 'A war-torn kingdom.',
        worldTimeOrigin: { year: 2024, month: 3, day: 10 },
      },
      leadName: 'Kade',
      opening: { ...base.opening, content: 'Kade set out at first light.' },
    }

    const { storyId } = await saveStoryDraft(draftState, ctx, 1000)

    const loaded = await loadDraft(storyId, ctx)
    expect(loaded).not.toBeNull()
    expect(loaded!.definition.mode).toBe('adventure')
    expect(loaded!.definition.narration).toBe('first')
    expect(loaded!.definition.genre).toEqual({
      label: 'High fantasy',
      promptBody: 'Epic stakes, sweeping scale.',
    })
    expect(loaded!.definition.worldTimeOrigin).toEqual({ year: 2024, month: 3, day: 10 })
    expect(loaded!.definition.title).toBe('The Long Road')
    expect(loaded!.definition.tone).toEqual({
      label: 'Hopeful',
      promptBody: 'Warmth even in hardship.',
    })
    expect(loaded!.definition.setting).toBe('A war-torn kingdom.')
    expect(loaded!.step).toBe(5)
    expect(loaded!.leadName).toBe('Kade')
    expect(loaded!.opening.content).toBe('Kade set out at first light.')

    const [preFinishStory] = await db.select().from(stories).where(eq(stories.id, storyId))
    expect(preFinishStory.status).toBe('draft')

    const navigate = vi.fn()
    const result = await finishWizard(loaded!, ctx, navigate, APP_DEFAULTS, 2000, storyId)

    expect(result).toEqual({ status: 'ok', storyId })
    const [storyRow] = await db.select().from(stories).where(eq(stories.id, storyId))
    expect(storyRow.status).toBe('active')
    expect(storyRow.id).toBe(storyId)
    expect(await db.select().from(deltas)).toHaveLength(0)

    const sessionRows = await db.select().from(wizardSessions).where(eq(wizardSessions.id, storyId))
    expect(sessionRows).toHaveLength(0)
  })
})
