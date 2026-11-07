// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { useController, type Control } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chapterDraftFrom, type ChapterDraft, type ChapterDraftRow } from '@/lib/chapters'

import { useChapterRowSession } from './use-chapter-row-session'

// react-hook-form picks its native path (field subscriptions in passive effects) at module load,
// by window.HTMLElement; hidden until the imports below have evaluated.
const htmlElement = vi.hoisted(() => {
  const saved = window.HTMLElement
  Reflect.deleteProperty(window, 'HTMLElement')
  return saved
})
Object.defineProperty(window, 'HTMLElement', {
  value: htmlElement,
  configurable: true,
  writable: true,
})

const KEEP: ChapterDraftRow = {
  id: 'chap_keep',
  title: 'The Keep Leans Closer',
  theme: 'pressure and pacts',
  summary: 'The courier reaches the keep at dusk.',
  keywords: ['Keep'],
}
const RAIN: ChapterDraftRow = {
  id: 'chap_rain',
  title: 'Nine Days of Rain',
  theme: 'patience',
  summary: 'The rain holds the road shut.',
  keywords: ['Rain'],
}
const ROWS = new Map([KEEP, RAIN].map((row) => [row.id, chapterDraftFrom(row)]))
const NONE_VALUES = chapterDraftFrom(null)

function TitleField({ control }: { control: Control<ChapterDraft> }) {
  const { field } = useController({ control, name: 'title' })
  return <output aria-label="Title">{field.value}</output>
}

const noop = () => {}
const onSave = async () => ({ status: 'ok' as const, id: KEEP.id })

/** The route's shape: one session, and each card mounting its own fields as it expands. */
function Timeline({ expandedId }: { expandedId: string | null }) {
  const values = (expandedId == null ? null : ROWS.get(expandedId)) ?? NONE_VALUES
  const session = useChapterRowSession({
    rowId: expandedId,
    values,
    onSave,
    onSaved: noop,
    onSession: noop,
  })
  return (
    <>
      {[KEEP.id, RAIN.id].map((id) =>
        id === expandedId && session.formRowId === id ? (
          <TitleField key={id} control={session.form.control} />
        ) : null,
      )}
    </>
  )
}

afterEach(cleanup)

describe('useChapterRowSession formRowId, on react-hook-form native path', () => {
  it("shows each opened card's own row, on the first open and on a switch", () => {
    const view = render(<Timeline expandedId={null} />)
    act(() => view.rerender(<Timeline expandedId={KEEP.id} />))
    expect(screen.getByRole('status', { name: 'Title' }).textContent).toBe(KEEP.title)
    act(() => view.rerender(<Timeline expandedId={RAIN.id} />))
    expect(screen.getByRole('status', { name: 'Title' }).textContent).toBe(RAIN.title)
    act(() => view.rerender(<Timeline expandedId={KEEP.id} />))
    expect(screen.getByRole('status', { name: 'Title' }).textContent).toBe(KEEP.title)
  })
})
