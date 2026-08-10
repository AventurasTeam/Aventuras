import { describe, expect, it } from 'vitest'

import type { WizardLoreDraft } from '@/lib/db'

import {
  invalidLoreRowIds,
  loreRowErrors,
  needsReplaceConfirm,
  parsePriorityInput,
  PRIORITY_MAX,
  PRIORITY_MIN,
  worldStepValid,
} from './step-world-logic'

function row(patch: Partial<WizardLoreDraft> = {}): WizardLoreDraft {
  return {
    id: 'lore_1',
    title: 'Magic systems',
    body: 'Magic flows from sealed wells.',
    category: '',
    tags: [],
    injectionMode: 'auto',
    priority: 0,
    ...patch,
  }
}

describe('worldStepValid', () => {
  it('passes with no lore rows at all — the list is optional', () => {
    expect(worldStepValid([])).toBe(true)
  })

  it('passes when every row has a title and a body', () => {
    expect(worldStepValid([row(), row({ id: 'lore_2' })])).toBe(true)
  })

  it('blocks on an empty body — the creation invariant for any lore row', () => {
    expect(worldStepValid([row({ body: '' })])).toBe(false)
  })

  it('blocks on an empty title', () => {
    expect(worldStepValid([row({ title: '' })])).toBe(false)
  })

  it('treats whitespace-only as empty', () => {
    expect(worldStepValid([row({ body: '   \n  ' })])).toBe(false)
  })
})

describe('loreRowErrors', () => {
  it('is empty for a clean row', () => {
    expect(loreRowErrors(row())).toEqual([])
  })

  it('names title and body independently, both when both are blank', () => {
    expect(loreRowErrors(row({ title: '' }))).toEqual(['title'])
    expect(loreRowErrors(row({ body: '' }))).toEqual(['body'])
    expect(loreRowErrors(row({ title: '', body: '' }))).toEqual(['title', 'body'])
  })
})

describe('invalidLoreRowIds', () => {
  it('names each offending row so the list can render inline errors', () => {
    const rows = [row({ id: 'lore_a' }), row({ id: 'lore_b', body: '' }), row({ id: 'lore_c' })]
    expect(invalidLoreRowIds(rows)).toEqual(['lore_b'])
  })

  it('returns every offender in input order, not just the first', () => {
    const rows = [
      row({ id: 'lore_a' }),
      row({ id: 'lore_b', body: '' }),
      row({ id: 'lore_c', title: '' }),
    ]
    expect(invalidLoreRowIds(rows)).toEqual(['lore_b', 'lore_c'])
  })

  it('is empty when everything is clean', () => {
    expect(invalidLoreRowIds([row()])).toEqual([])
  })
})

describe('needsReplaceConfirm', () => {
  it('fires when a label is already set', () => {
    expect(needsReplaceConfirm({ label: 'Noir', promptBody: '' })).toBe(true)
  })

  it('fires when only the body is set', () => {
    expect(needsReplaceConfirm({ label: '', promptBody: 'Rain on wet asphalt.' })).toBe(true)
  })

  it('does not fire on a pristine field', () => {
    expect(needsReplaceConfirm({ label: '', promptBody: '' })).toBe(false)
  })

  it('does not fire on whitespace-only content', () => {
    expect(needsReplaceConfirm({ label: '  ', promptBody: '\n' })).toBe(false)
  })
})

describe('parsePriorityInput', () => {
  it('reads a plain number', () => {
    expect(parsePriorityInput('42')).toBe(42)
  })

  it('returns null for an emptied field so the row keeps its stored value', () => {
    expect(parsePriorityInput('')).toBeNull()
  })

  it('returns null when the text carries no digits at all', () => {
    expect(parsePriorityInput('abc')).toBeNull()
    expect(parsePriorityInput('   ')).toBeNull()
  })

  it('clamps above the ceiling instead of rejecting the keystroke', () => {
    // Distinct from PRIORITY_MAX as a literal: a mutant returning the input
    // unchanged, or one clamping to some other constant, both fail here.
    expect(parsePriorityInput('250')).toBe(100)
    expect(parsePriorityInput('999999999999999999999')).toBe(100)
  })

  it('never returns a value outside the field range', () => {
    for (const text of ['0', '1', '99', '100', '101', '7.5', '-5', '0012']) {
      const parsed = parsePriorityInput(text)
      expect(parsed).not.toBeNull()
      expect(parsed!).toBeGreaterThanOrEqual(PRIORITY_MIN)
      expect(parsed!).toBeLessThanOrEqual(PRIORITY_MAX)
    }
  })

  it('drops a leading minus rather than reading a negative', () => {
    // '-5' loses the sign and reads as 5 — the field holds whole numbers only,
    // so the nearest holdable value beats blocking the paste.
    expect(parsePriorityInput('-5')).toBe(5)
  })

  it('drops a decimal point rather than rounding', () => {
    expect(parsePriorityInput('7.5')).toBe(75)
  })

  it('reads a zero-padded value as its numeric value', () => {
    expect(parsePriorityInput('0012')).toBe(12)
  })
})
