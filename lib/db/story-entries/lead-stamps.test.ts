import { describe, expect, it } from 'vitest'

import { createTestDb } from '../__tests__/test-db'
import { branches, stories, storyEntries } from '../schema'
import type { NewStoryEntry } from '../types'
import type { EntryMetadata } from './entry-metadata'
import { readStampedLeadIds } from './lead-stamps'

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

const SCENE: EntryMetadata = { sceneEntities: [], currentLocationId: null, worldTime: 0 }

function stamped(leadId: string) {
  return { ...SCENE, leadId }
}

let position = 0
function entry(
  branchId: string,
  kind: NewStoryEntry['kind'],
  metadata: NewStoryEntry['metadata'],
): NewStoryEntry {
  position += 1
  return { id: `e${position}`, branchId, position, kind, content: 'Prose.', metadata, createdAt: 1 }
}

async function seed(rows: NewStoryEntry[]): Promise<TestDb> {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  await db.insert(storyEntries).values(rows)
  return db
}

describe('readStampedLeadIds', () => {
  it("returns the asked ids that a stamp on the branch's entries names", async () => {
    const db = await seed([
      entry('b2', 'user_action', stamped('char_c')),
      entry('b1', 'opening', stamped('char_a')),
      entry('b1', 'user_action', stamped('char_a')),
      entry('b1', 'ai_reply', stamped('char_b')),
      entry('b1', 'system', null),
      entry('b1', 'ai_reply', SCENE),
    ])

    expect(await readStampedLeadIds('b1', ['char_a', 'char_z'], db)).toEqual(new Set(['char_a']))
    expect(await readStampedLeadIds('b1', ['char_a', 'char_b'], db)).toEqual(
      new Set(['char_a', 'char_b']),
    )
  })

  it('finds no stamp that only another branch holds', async () => {
    const db = await seed([
      entry('b2', 'user_action', stamped('char_c')),
      entry('b1', 'user_action', stamped('char_a')),
    ])

    expect(await readStampedLeadIds('b1', ['char_c'], db)).toEqual(new Set())
    expect(await readStampedLeadIds('b2', ['char_c'], db)).toEqual(new Set(['char_c']))
  })

  it('reads nothing for no ids', async () => {
    const db = await seed([entry('b1', 'user_action', stamped('char_a'))])
    expect(await readStampedLeadIds('b1', [], db)).toEqual(new Set())
  })
})
