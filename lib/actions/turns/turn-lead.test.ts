import { describe, expect, it } from 'vitest'

import { branches, entities, stories, type StoryDefinition } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import { STORY_DEFINITION } from './__tests__/fixtures'
import { turnLeadOf } from './turn-lead'

const IDS = { storyId: 's1', branchId: 'b1' }

function shaped(
  mode: StoryDefinition['mode'],
  narration: StoryDefinition['narration'],
): StoryDefinition {
  return { ...STORY_DEFINITION, mode, narration }
}

// b2 is a sibling of b1: a character flagged there says nothing about b1's lead.
async function storyOn(
  definition: StoryDefinition | null,
  flagged: readonly { branchId: string; id: string }[] = [],
) {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({
    id: 's1',
    title: 'T',
    status: 'active',
    definition,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'side', createdAt: 2 },
  ])
  for (const row of flagged)
    await db
      .insert(entities)
      .values(makeEntity({ ...row, kind: 'character', name: row.id, isLead: 1 }))
  return { db, runInTransaction }
}

describe('turnLeadOf', () => {
  it.each([
    ['adventure', 'third'],
    ['creative', 'first'],
    ['creative', 'second'],
  ] as const)(
    'reads a %s %s-person branch with no flagged character as missing its lead',
    async (mode, narration) => {
      const ctx = await storyOn(shaped(mode, narration))
      expect(await turnLeadOf(IDS, ctx)).toEqual({ lead: null, missing: true })
    },
  )

  it('needs no lead on a creative third-person branch', async () => {
    const ctx = await storyOn(shaped('creative', 'third'))
    expect(await turnLeadOf(IDS, ctx)).toEqual({ lead: null, missing: false })
  })

  it('hands back the flagged character, with nothing missing', async () => {
    const ctx = await storyOn(shaped('adventure', 'second'), [{ branchId: 'b1', id: 'char_kael' }])
    const read = await turnLeadOf(IDS, ctx)
    expect(read.missing).toBe(false)
    expect(read.lead?.id).toBe('char_kael')
  })

  // The stamp reads the same lead, so a branch that needs none still hands it back.
  it('hands back the lead of a creative third-person branch too', async () => {
    const ctx = await storyOn(shaped('creative', 'third'), [{ branchId: 'b1', id: 'char_kael' }])
    expect(await turnLeadOf(IDS, ctx)).toMatchObject({ lead: { id: 'char_kael' }, missing: false })
  })

  it("reads the named branch's lead, not a sibling's", async () => {
    const ctx = await storyOn(shaped('adventure', 'second'), [{ branchId: 'b2', id: 'char_kael' }])
    expect(await turnLeadOf(IDS, ctx)).toEqual({ lead: null, missing: true })
  })

  // data-model.md → The lead: a reader finding two reads the branch as having none.
  it('reads a branch with two flagged characters as missing its lead', async () => {
    const ctx = await storyOn(shaped('adventure', 'second'), [
      { branchId: 'b1', id: 'char_kael' },
      { branchId: 'b1', id: 'char_mira' },
    ])
    expect(await turnLeadOf(IDS, ctx)).toEqual({ lead: null, missing: true })
  })

  it('needs no lead of a story with no definition', async () => {
    const ctx = await storyOn(null)
    expect(await turnLeadOf(IDS, ctx)).toEqual({ lead: null, missing: false })
  })
})
