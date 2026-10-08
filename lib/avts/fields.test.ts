import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { t } from '@/lib/i18n'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'

import { optionalText, priorityField, requiredText, termList } from './fields'

function messages(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('requiredText', () => {
  const field = requiredText(() => 'Needs text.')

  it('keeps text trimmed', () => {
    expect(field.parse('  Kael ')).toBe('Kael')
  })

  it.each([undefined, null, '', '  \n '])('refuses %j with its own message', (value) => {
    expect(messages(field, value)).toEqual(['Needs text.'])
  })

  it('leaves a wrong type to Zod', () => {
    const result = field.safeParse(42)
    expect(result.error?.issues.map((issue) => issue.code)).toEqual(['invalid_type'])
    expect(messages(field, 42)).not.toEqual(['Needs text.'])
  })
})

describe('optionalText', () => {
  it.each([undefined, null, '', '  \t'])('reads %j as null', (value) => {
    expect(optionalText.parse(value)).toBeNull()
  })

  it('keeps text trimmed', () => {
    expect(optionalText.parse('  a hill fort ')).toBe('a hill fort')
  })
})

describe('priorityField', () => {
  it('defaults to 0', () => {
    expect(priorityField.parse(undefined)).toBe(0)
  })

  it.each([0, 55, 100])('keeps %j', (value) => {
    expect(priorityField.parse(value)).toBe(value)
  })

  it.each([-1, 101, 2.5, '5', null])('refuses %j with the range copy', (value) => {
    expect(messages(priorityField, value)).toEqual(['Enter a whole number from 0 to 100.'])
  })
})

describe('termList', () => {
  it('defaults to an empty list', () => {
    expect(termList.parse(undefined)).toEqual([])
  })

  it('keeps the terms in order', () => {
    expect(termList.parse(['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('common:avts copy', () => {
  it.each([
    'common:avts.issue.nameRequired',
    'common:avts.issue.titleRequired',
    'common:avts.issue.bodyRequired',
    'common:avts.issue.timeAnchorExclusive',
    'common:avts.issue.priorityRange',
    'common:avts.issue.stackableKeyRequired',
    'common:avts.issue.duplicateStackable',
    'common:avts.issue.expectedKind.character',
    'common:avts.issue.expectedKind.location',
    'common:avts.issue.expectedKind.item',
    'common:avts.issue.expectedKind.faction',
    'common:avts.exportFailed',
  ])('%s resolves', (key) => {
    expect(hasCopy(key)).toBe(true)
  })

  it('names the expected kind as the import dialog shows it', () => {
    expect(t('common:avts.issue.expectedKind.character')).toBe('Expected a character.')
    expect(t('common:avts.issue.expectedKind.item')).toBe('Expected an item.')
  })
})
