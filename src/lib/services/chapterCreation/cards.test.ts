import { describe, it, expect, vi } from 'vitest'
import type { Chapter } from '#lib/types/index.ts'
import { ChapterCards } from './cards'

const chapter = { id: 'ch7', title: 'The Ferry', startEntryId: 'e10' } as Chapter

function cards() {
  const notify = vi.fn()
  const onChange = vi.fn()
  const store = new ChapterCards(onChange, notify)
  const card = store.start({ storyId: 's', branchId: 'b', anchorEntryId: 'n41', number: 7 })
  return { store, card, notify, onChange }
}

describe('ChapterCards', () => {
  it('starts summarizing, keyed for its record, with nothing known about the chapter yet', () => {
    const { card } = cards()
    expect(card).toMatchObject({
      phase: 'summarizing',
      number: 7,
      title: null,
      chapterId: null,
      recordKey: `chapter:${card.id}`,
    })
  })

  it('takes the title and chapter when the summary returns, and moves to lore', () => {
    const { store, card } = cards()
    store.summarized(card.id, chapter)
    expect(store.get(card.id)).toMatchObject({
      phase: 'lore',
      title: 'The Ferry',
      chapterId: 'ch7',
      chapterStartEntryId: 'e10',
      loreRuns: 1,
    })
  })

  it('finishes when lore management finishes', () => {
    const { store, card, notify } = cards()
    store.summarized(card.id, chapter)
    store.loreFinished(card.id)
    expect(store.get(card.id)?.phase).toBe('finished')
    expect(notify).not.toHaveBeenCalled()
  })

  it('records a failed summary with its reason, and warns once', () => {
    const { store, card, notify } = cards()
    store.summaryFailed(card.id, '401 · invalid API key')
    expect(store.get(card.id)).toMatchObject({
      phase: 'summary-failed',
      reason: '401 · invalid API key',
    })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('no chapter was created')
  })

  it('records incomplete lore with its reason, and warns naming the chapter', () => {
    const { store, card, notify } = cards()
    store.summarized(card.id, chapter)
    store.loreIncomplete(card.id, 'provider down')
    expect(store.get(card.id)).toMatchObject({
      phase: 'lore-incomplete',
      reason: 'provider down',
    })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('Chapter 7 was created')
  })

  it('goes back to lore on a restart, and warns again if that run fails too', () => {
    const { store, card, notify } = cards()
    store.summarized(card.id, chapter)
    store.loreIncomplete(card.id, 'provider down')

    store.loreRestarted(card.id)
    expect(store.get(card.id)).toMatchObject({ phase: 'lore', reason: null, loreRuns: 2 })

    store.loreIncomplete(card.id, 'still down')
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('finds the cards reporting a chapter', () => {
    const { store, card } = cards()
    expect(store.withChapter('ch7')).toEqual([])
    store.summarized(card.id, chapter)
    expect(store.withChapter('ch7').map((c) => c.id)).toEqual([card.id])
  })

  it('is gone once removed', () => {
    const { store, card } = cards()
    store.remove(card.id)
    expect(store.get(card.id)).toBeUndefined()
    expect(store.forScope('s', 'b')).toEqual([])
  })

  describe('pending', () => {
    it('holds while summarizing and while lore management runs, a restarted run included', () => {
      const { store, card } = cards()
      expect(store.pending('s', 'b')).toBe(true)
      store.summarized(card.id, chapter)
      expect(store.pending('s', 'b')).toBe(true)
      store.loreIncomplete(card.id, 'down')
      expect(store.pending('s', 'b')).toBe(false)
      store.loreRestarted(card.id)
      expect(store.pending('s', 'b')).toBe(true)
      store.loreFinished(card.id)
      expect(store.pending('s', 'b')).toBe(false)
    })

    it('does not hold after a failed summary', () => {
      const { store, card } = cards()
      store.summaryFailed(card.id, 'down')
      expect(store.pending('s', 'b')).toBe(false)
    })

    it('belongs to its own branch only', () => {
      const { store } = cards()
      expect(store.pending('s', null)).toBe(false)
      expect(store.pending('other', 'b')).toBe(false)
      expect(store.forScope('s', null)).toEqual([])
    })
  })
})
