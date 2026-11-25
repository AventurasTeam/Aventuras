import { describe, it, expect } from 'vitest'
import { loreModelCallReason, loreToolOutcome, loreToolStep } from './loreSteps'

const call = (toolName: string, input?: unknown) => ({ toolName, input })
const reason = (over: Partial<Parameters<typeof loreModelCallReason>[0]> = {}) =>
  loreModelCallReason({ stepNumber: 1, isLast: false, previous: [], openDuplicates: 0, ...over })

describe('loreModelCallReason', () => {
  it('opens by reviewing the lorebook, against the new chapter when there is one', () => {
    expect(reason({ stepNumber: 0 })).toBe('Review the lorebook')
    expect(reason({ stepNumber: 0, newChapterNumber: 7 })).toBe(
      'Review the lorebook against Chapter 7',
    )
  })

  it('continues after what the previous call’s tools did', () => {
    expect(
      reason({
        previous: [
          call('query_chapter', { chapterNumber: 5 }),
          call('update_entry'),
          call('update_entry'),
          call('read_entry'),
        ],
      }),
    ).toBe('Continue after reviewing entries, reading Chapter 5 and revising 2 entries')
  })

  it('resolves the duplicates a refused finish left open', () => {
    expect(reason({ previous: [call('finish_lore_management')], openDuplicates: 2 })).toBe(
      'Resolve 2 open duplicate groups',
    )
  })

  it('sums up on the forced last call', () => {
    expect(reason({ stepNumber: 9, isLast: true, previous: [call('update_entry')] })).toBe(
      'Sum up: step limit reached',
    )
  })

  it('still says something with no tool calls before it', () => {
    expect(reason()).toBe('Continue')
  })
})

describe('loreToolStep', () => {
  const names = ['Harbor Master Ilsa', 'Docks', 'Old Docks']
  const nameAt = (i: number) => names[i]

  it('names the entries a call touches', () => {
    expect(loreToolStep(call('update_entry', { index: 0 }), nameAt).label).toBe(
      'Revise "Harbor Master Ilsa"',
    )
    expect(loreToolStep(call('merge_entries', { indices: [1, 2] }), nameAt).label).toBe(
      'Merge "Docks" and "Old Docks"',
    )
    expect(loreToolStep(call('create_entry', { name: 'The Ferry' }), nameAt).label).toBe(
      'Add "The Ferry"',
    )
    expect(loreToolStep(call('delete_entry', { index: 9 }), nameAt).label).toBe('Remove entry 9')
  })

  it('marks a chapter read as an LLM step', () => {
    expect(loreToolStep(call('query_chapter', { chapterNumber: 5 }), nameAt)).toEqual({
      label: 'Read Chapter 5',
      isLLM: true,
    })
  })
})

describe('loreToolOutcome', () => {
  it('fails a call the tool refused, with its reason', () => {
    expect(loreToolOutcome({ success: false, error: 'out of range' })).toEqual({
      status: 'failed',
      error: 'out of range',
    })
  })

  it('notes a finish that was not accepted yet', () => {
    expect(loreToolOutcome({ completed: false, message: '...' })).toEqual({
      status: 'done',
      detail: 'not accepted yet',
    })
  })

  it('is done otherwise', () => {
    expect(loreToolOutcome({ success: true })).toEqual({ status: 'done' })
  })
})
