import { beforeEach, describe, expect, it } from 'vitest'

import {
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  type Entity,
  type StoryEntry,
} from '@/lib/db'
import { currentStoryStore, entitiesStore, entriesStore } from '@/lib/stores'

import { loadPerTurnWorkingSet } from './working-set'

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'creative',
  leadEntityId: null,
  narration: 'third',
  genre: { label: 'Fantasy', promptBody: '' },
  tone: { label: 'Wry', promptBody: '' },
  setting: '',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

function entry(id: string, position: number, branchId = 'b1'): StoryEntry {
  return {
    id,
    branchId,
    position,
    kind: 'ai_reply',
    content: id,
    chapterId: null,
    metadata: { sceneEntities: [], currentLocationId: null, worldTime: 0 },
    createdAt: 1,
  }
}

function entity(id: string, branchId = 'b1'): Entity {
  return {
    id,
    branchId,
    kind: 'character',
    name: id,
    description: null,
    tags: [],
    status: 'active',
    retiredReason: null,
    nameCollisionFlag: 0,
    injectionMode: 'auto',
    state: null,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

const RUN = { storyId: 's1', branchId: 'b1' }

function openStory(over: { storyId?: string; branchId?: string } = {}): void {
  currentStoryStore.set({
    storyId: over.storyId ?? 's1',
    branchId: over.branchId ?? 'b1',
    definition: DEFINITION,
    settings: STORY_SETTINGS_DEFAULTS,
  })
}

describe('loadPerTurnWorkingSet', () => {
  beforeEach(() => {
    currentStoryStore.__reset()
    entriesStore.__reset()
    entitiesStore.__reset()
  })

  it.each([
    { case: 'no story is open', open: null },
    { case: 'the open story is another branch', open: { branchId: 'b2' } },
    { case: 'the open story is another story', open: { storyId: 's2' } },
  ])('refuses the run when $case', ({ open }) => {
    if (open) openStory(open)
    entriesStore.hydrate('b1', [])

    expect(loadPerTurnWorkingSet(RUN, 'phase')).toEqual({
      ok: false,
      result: {
        status: 'failed',
        error: { kind: 'orchestrator', detail: 'phase: no open story for branch' },
      },
    })
  })

  it('refuses the run when the entries store holds another branch', () => {
    openStory()
    entriesStore.hydrate('b2', [])

    expect(loadPerTurnWorkingSet(RUN, 'phase')).toEqual({
      ok: false,
      result: {
        status: 'failed',
        error: { kind: 'orchestrator', detail: 'phase: entries store loaded for another branch' },
      },
    })
  })

  // Positive control for the four refusals: the same call succeeds once every
  // identity agrees, so those assertions are about the guards, not the setup.
  it('loads the set when the open story and the entries store both match', () => {
    openStory()
    entriesStore.hydrate('b1', [entry('e1', 1)])
    entitiesStore.hydrate('b1', [entity('char_1')])

    const load = loadPerTurnWorkingSet(RUN, 'phase')
    expect(load.ok).toBe(true)
    if (!load.ok) return
    expect(load.set.open.storyId).toBe('s1')
    expect(load.set.entries.map((e) => e.id)).toEqual(['e1'])
    expect(load.set.entities.map((e) => e.id)).toEqual(['char_1'])
  })

  it('returns entries ascending by position, not in map order', () => {
    openStory()
    entriesStore.hydrate('b1', [entry('e3', 3), entry('e1', 1), entry('e2', 2)])

    const load = loadPerTurnWorkingSet(RUN, 'phase')
    expect(load.ok && load.set.entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  // The branch guard above already refuses a store hydrated elsewhere, so these
  // filters only catch a row tagged for another branch inside the held one.
  // They stay because metadata inheritance and the retrieval query read the
  // tail of this set, and a foreign row would be the wrong story's.
  it('drops rows tagged for another branch inside the held one', () => {
    openStory()
    entriesStore.hydrate('b1', [entry('e1', 1), entry('foreign', 2, 'b2')])
    entitiesStore.hydrate('b1', [entity('char_1'), entity('char_foreign', 'b2')])

    const load = loadPerTurnWorkingSet(RUN, 'phase')
    expect(load.ok && load.set.entries.map((e) => e.id)).toEqual(['e1'])
    expect(load.ok && load.set.entities.map((e) => e.id)).toEqual(['char_1'])
  })
})
