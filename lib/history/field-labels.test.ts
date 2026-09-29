import { afterEach, describe, expect, it } from 'vitest'

import { UPDATABLE as ENTITY_UPDATABLE } from '@/lib/actions/entities/register'
import { UPDATABLE as HAPPENING_UPDATABLE } from '@/lib/actions/happenings/register-happenings'
import { UPDATABLE as LORE_UPDATABLE } from '@/lib/actions/lore/register'
import { UPDATABLE as THREAD_UPDATABLE } from '@/lib/actions/threads/register'
import { entityStateColumnSchema } from '@/lib/db'
import { i18n } from '@/lib/i18n'

import { fieldPathLabel, HISTORY_TABLES, opsMatchingLabel, summaryFieldTerms } from './field-labels'

const UPDATABLE_BY_TABLE: Record<(typeof HISTORY_TABLES)[number], readonly string[]> = {
  entities: ENTITY_UPDATABLE,
  lore: LORE_UPDATABLE,
  threads: THREAD_UPDATABLE,
  happenings: HAPPENING_UPDATABLE,
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
