import { describe, expect, it } from 'vitest'

import { entityStateColumnSchema } from '@/lib/db'

import { fieldPathLabel, HISTORY_TABLES } from './field-labels'

// Mirrors each handler's UPDATABLE array (lib/actions/{entities,lore,threads,happenings}/
// register*.ts) — not importable here: those consts are file-local, not part of lib/actions'
// public API (its index.ts). Keep this list in sync when a handler's UPDATABLE array changes.
const UPDATABLE_BY_TABLE: Record<(typeof HISTORY_TABLES)[number], readonly string[]> = {
  entities: [
    'name',
    'description',
    'status',
    'retiredReason',
    'injectionMode',
    'tags',
    'keywords',
    'priority',
    'state',
  ],
  lore: ['title', 'body', 'category', 'tags', 'keywords', 'injectionMode', 'priority'],
  threads: [
    'title',
    'description',
    'category',
    'icon',
    'status',
    'injectionMode',
    'triggeredAtEntryId',
    'resolvedAtEntryId',
  ],
  happenings: [
    'title',
    'description',
    'category',
    'icon',
    'temporal',
    'occurredAtEntryId',
    'commonKnowledge',
  ],
}

describe('field-labels vocabulary coverage', () => {
  it('labels every updatable column of every history table', () => {
    for (const table of HISTORY_TABLES) {
      for (const column of UPDATABLE_BY_TABLE[table]) {
        expect(fieldPathLabel(table, column)).not.toBe(column)
      }
    }
  })

  it("labels every path in entities' state column schema, including state.visual's keys", () => {
    for (const key of Object.keys(entityStateColumnSchema.shape)) {
      expect(fieldPathLabel('entities', `state.${key}`)).not.toBe(`state.${key}`)
    }
    for (const key of Object.keys(entityStateColumnSchema.shape.visual.shape)) {
      expect(fieldPathLabel('entities', `state.visual.${key}`)).not.toBe(`state.visual.${key}`)
    }
  })
})
