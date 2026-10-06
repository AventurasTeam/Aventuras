import { afterEach, describe, expect, it } from 'vitest'

import { UPDATABLE as ENTITY_UPDATABLE } from '@/lib/actions/entities/register'
import { UPDATABLE as HAPPENING_UPDATABLE } from '@/lib/actions/happenings/register-happenings'
import { UPDATABLE as LORE_UPDATABLE } from '@/lib/actions/lore/register'
import { UPDATABLE as THREAD_UPDATABLE } from '@/lib/actions/threads/register'
import { entityStateColumnSchema } from '@/lib/db'
import { i18n } from '@/lib/i18n'

import {
  fieldPathLabel,
  HISTORY_TABLES,
  linkLabelsMatching,
  opsMatchingLabel,
  pathsMatchingLabel,
  removalSummaryTerm,
  summaryFieldTerms,
} from './field-labels'
import { HISTORY_LINK_TABLES, type HistoryLinkTable } from './link-rows'

const UPDATABLE_BY_TABLE: Record<(typeof HISTORY_TABLES)[number], readonly string[]> = {
  entities: ENTITY_UPDATABLE,
  lore: LORE_UPDATABLE,
  threads: THREAD_UPDATABLE,
  happenings: HAPPENING_UPDATABLE,
}

// The columns each link arm's update writes (lib/actions/relationships, lib/actions/happenings).
const LINK_COLUMNS: Record<HistoryLinkTable, readonly string[]> = {
  character_relationships: ['kind', 'inverseKind'],
  happening_involvements: ['role'],
  happening_awareness: ['source', 'decayResistance', 'learnedAtEntryId'],
}

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

  it('labels every column a link arm updates, from either side of a relationship', () => {
    for (const table of HISTORY_LINK_TABLES) {
      for (const column of LINK_COLUMNS[table]) {
        for (const side of ['a', 'b', null] as const) {
          expect(fieldPathLabel(table, column, side)).not.toBe(column)
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

  it('follows a locale that puts the name first', async () => {
    i18n.addResourceBundle('xx', 'history', { summary: { removedWith: '{{name}} mit entfernt' } })
    await i18n.changeLanguage('xx')
    expect(removalSummaryTerm('Kael mit entfernt')).toEqual({ kind: 'named', name: 'Kael' })
    expect(removalSummaryTerm('Removed when Kael was deleted')).toBeNull()
  })
})
