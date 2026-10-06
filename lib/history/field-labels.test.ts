import { getTableColumns } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { UPDATABLE as ENTITY_UPDATABLE } from '@/lib/actions/entities/register'
import { UPDATABLE as HAPPENING_UPDATABLE } from '@/lib/actions/happenings/register-happenings'
import { UPDATABLE as LORE_UPDATABLE } from '@/lib/actions/lore/register'
import { UPDATABLE as THREAD_UPDATABLE } from '@/lib/actions/threads/register'
import {
  characterRelationships,
  entityStateColumnSchema,
  happeningAwareness,
  happeningInvolvements,
} from '@/lib/db'
import { i18n } from '@/lib/i18n'

import {
  fieldPathLabel,
  HISTORY_TABLES,
  linkLabelsMatching,
  opsMatchingLabel,
  pathsMatchingLabel,
  removalSummaryTerm,
  removalTargetLabel,
  summaryFieldTerms,
} from './field-labels'
import { HISTORY_LINK_TABLES } from './link-rows'

const UPDATABLE_BY_TABLE: Record<(typeof HISTORY_TABLES)[number], readonly string[]> = {
  entities: ENTITY_UPDATABLE,
  lore: LORE_UPDATABLE,
  threads: THREAD_UPDATABLE,
  happenings: HAPPENING_UPDATABLE,
}

const LINK_TABLE_DEFS = {
  character_relationships: characterRelationships,
  happening_involvements: happeningInvolvements,
  happening_awareness: happeningAwareness,
} as const

// Identity, branch and the two ends are structure, not edited values; the awareness counter is
// bumped by the memory pipeline and its label is left out on purpose.
const STRUCTURAL_COLUMNS = new Set([
  'id',
  'branchId',
  'aId',
  'bId',
  'happeningId',
  'entityId',
  'characterId',
  'createdAt',
  'updatedAt',
  'retrievalCount',
])

describe('field-labels vocabulary coverage', () => {
  it('labels every updatable column of every history table', () => {
    for (const table of HISTORY_TABLES) {
      for (const column of UPDATABLE_BY_TABLE[table]) {
        expect(fieldPathLabel(table, column)).not.toBe(column)
      }
    }
  })

  it("labels every path in entities' state column schema, distinctly from its parent's label", () => {
    const stateLabel = fieldPathLabel('entities', 'state')
    const visualLabel = fieldPathLabel('entities', 'state.visual')
    for (const key of Object.keys(entityStateColumnSchema.shape)) {
      expect(fieldPathLabel('entities', `state.${key}`)).not.toBe(stateLabel)
    }
    for (const key of Object.keys(entityStateColumnSchema.shape.visual.shape)) {
      expect(fieldPathLabel('entities', `state.visual.${key}`)).not.toBe(visualLabel)
    }
  })

  it('labels every editable column of every link table, from either side of a relationship', () => {
    for (const table of HISTORY_LINK_TABLES) {
      const columns = Object.keys(getTableColumns(LINK_TABLE_DEFS[table])).filter(
        (column) => !STRUCTURAL_COLUMNS.has(column),
      )
      expect(columns.length).toBeGreaterThan(0)
      for (const column of columns) {
        if (table === 'character_relationships') {
          expect(fieldPathLabel(table, column, 'a')).not.toBe(column)
          expect(fieldPathLabel(table, column, 'b')).not.toBe(column)
        } else {
          expect(fieldPathLabel(table, column)).not.toBe(column)
        }
      }
    }
  })
})

describe('link-row labels', () => {
  it("labels a relationship's two views by the tab's side of the pair", () => {
    expect(fieldPathLabel('character_relationships', 'kind', 'a')).toBe('Your view')
    expect(fieldPathLabel('character_relationships', 'inverseKind', 'a')).toBe('Their view')
    expect(fieldPathLabel('character_relationships', 'kind', 'b')).toBe('Their view')
    expect(fieldPathLabel('character_relationships', 'inverseKind', 'b')).toBe('Your view')
    expect(pathsMatchingLabel('character_relationships', 'your', 'a')).toEqual(['kind'])
    expect(pathsMatchingLabel('character_relationships', 'your', 'b')).toEqual(['inverseKind'])
  })

  it('refuses a relationship lookup that names no side, rather than guessing side a', () => {
    // @ts-expect-error a relationship's labels depend on the tab's side
    expect(() => fieldPathLabel('character_relationships', 'kind')).toThrow()
    // @ts-expect-error a relationship's labels depend on the tab's side
    expect(() => fieldPathLabel('character_relationships', 'kind', null)).toThrow()
    // @ts-expect-error a relationship's labels depend on the tab's side
    expect(() => pathsMatchingLabel('character_relationships', 'view')).toThrow()
  })

  it('labels involvement and awareness columns, and leaves the retrieval counter raw', () => {
    expect(fieldPathLabel('happening_involvements', 'role')).toBe('Role')
    expect(
      ['source', 'decayResistance', 'learnedAtEntryId'].map((column) =>
        fieldPathLabel('happening_awareness', column),
      ),
    ).toEqual(['Source', 'Decay resistance', 'Learned at'])
    expect(fieldPathLabel('happening_awareness', 'retrievalCount')).toBe('retrievalCount')
  })
})

describe('removalTargetLabel', () => {
  it('names one table by its link label and several as "Links"', () => {
    expect(removalTargetLabel(['character_relationships'])).toBe('Relationship')
    expect(removalTargetLabel(['happening_awareness'])).toBe('Awareness')
    expect(removalTargetLabel(['happening_involvements', 'happening_awareness'])).toBe('Links')
  })
})

describe('linkLabelsMatching', () => {
  it('matches a link label by word start, not by substring anywhere', () => {
    expect(linkLabelsMatching('rel')).toEqual(['character_relationships'])
    expect(linkLabelsMatching('Aware')).toEqual(['happening_awareness'])
    expect(linkLabelsMatching('ship')).toEqual([])
    expect(linkLabelsMatching(' ')).toEqual([])
  })
})

describe('opsMatchingLabel', () => {
  it('matches a label by word start, not by substring anywhere', () => {
    expect(opsMatchingLabel('date')).toEqual([])
    expect(opsMatchingLabel('cre')).toEqual(['create'])
  })
})

describe('summaryFieldTerms', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
    i18n.removeResourceBundle('xx', 'history')
  })

  it('reads the named fields off the rendered update summary, only when worded as one', () => {
    expect(summaryFieldTerms('modified Traits, Drives')).toEqual(['Traits', 'Drives'])
    expect(summaryFieldTerms('Modified')).toBeNull()
    expect(summaryFieldTerms('ModifiedTraits')).toBeNull()
    expect(summaryFieldTerms('Traits')).toBeNull()
  })

  it('follows a locale that puts the fields before the verb', async () => {
    i18n.addResourceBundle('xx', 'history', { summary: { modified: '{{fields}} geändert' } })
    await i18n.changeLanguage('xx')
    expect(summaryFieldTerms('Traits geändert')).toEqual(['Traits'])
    expect(summaryFieldTerms('Modified Traits')).toBeNull()
  })
})

describe('removalSummaryTerm', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
    i18n.removeResourceBundle('xx', 'history')
  })

  it('reads the other end off a removal summary typed whole, and any removal off a word of it', () => {
    expect(removalSummaryTerm('Removed when Kael was deleted')).toEqual({
      kind: 'named',
      name: 'Kael',
    })
    expect(removalSummaryTerm('removed when old tom was deleted')).toEqual({
      kind: 'named',
      name: 'old tom',
    })
    expect(removalSummaryTerm('remov')).toEqual({ kind: 'any' })
    expect(removalSummaryTerm('moved')).toBeNull()
    expect(removalSummaryTerm('Kael')).toBeNull()
  })

  it('matches a word of the summary tail, and nothing for an empty term', () => {
    expect(removalSummaryTerm('deleted')).toEqual({ kind: 'any' })
    expect(removalSummaryTerm(' ')).toBeNull()
  })

  it('follows the sentence as it is typed, lead then name then tail', () => {
    expect(removalSummaryTerm('Removed when')).toEqual({ kind: 'any' })
    expect(removalSummaryTerm('was deleted')).toEqual({ kind: 'any' })
    expect(removalSummaryTerm('Removed when Ka')).toEqual({ kind: 'named', name: 'Ka' })
    expect(removalSummaryTerm('removed when old tom')).toEqual({ kind: 'named', name: 'old tom' })
    expect(removalSummaryTerm('Removed when Kael w')).toEqual({ kind: 'named', name: 'Kael' })
    expect(removalSummaryTerm('Removed when Kael was del')).toEqual({ kind: 'named', name: 'Kael' })
    expect(removalSummaryTerm('Removed whenever')).toBeNull()
  })

  it('reads the unknown-other-end wording whole as any removal', () => {
    expect(removalSummaryTerm('Removed when its other end was deleted')).toEqual({ kind: 'any' })
  })

  it('follows a locale that puts the name first', async () => {
    i18n.addResourceBundle('xx', 'history', { summary: { removedWith: '{{name}} mit entfernt' } })
    await i18n.changeLanguage('xx')
    expect(removalSummaryTerm('Kael mit entfernt')).toEqual({ kind: 'named', name: 'Kael' })
    expect(removalSummaryTerm('Removed when Kael was deleted')).toBeNull()
  })

  it('matches a word of a name-first tail, and a name typed ahead of it', async () => {
    i18n.addResourceBundle('xx', 'history', { summary: { removedWith: '{{name}} mit entfernt' } })
    await i18n.changeLanguage('xx')
    expect(removalSummaryTerm('entf')).toEqual({ kind: 'any' })
    expect(removalSummaryTerm('Kael mi')).toEqual({ kind: 'named', name: 'Kael' })
    expect(removalSummaryTerm('Kael')).toBeNull()
  })
})
