import { describe, expect, it } from 'vitest'

import { closeChapterReason } from './close-chapter-reason'

const GATE = 'Generation is in flight. Cancel to edit.'

describe('closeChapterReason', () => {
  it('names the run gate while it holds, with or without a reply to end on', () => {
    expect(closeChapterReason(GATE, true)).toBe(GATE)
    expect(closeChapterReason(GATE, false)).toBe(GATE)
  })

  it('names the missing reply when no run gates it', () => {
    expect(closeChapterReason(undefined, false)).toBe('No reply to end a chapter on yet')
  })

  it('leaves the close enabled with a reply and no run', () => {
    expect(closeChapterReason(undefined, true)).toBeUndefined()
  })
})
