// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { useController, type Control } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chapterDraftFrom, type ChapterDraft, type ChapterDraftRow } from '@/lib/chapters'

import { useChapterRowSession } from './use-chapter-row-session'

// react-hook-form picks its native path (field subscriptions in passive effects) at module load,
// by window.HTMLElement; vi.hoisted runs before the imports above, so they load with it hidden.
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
  branchId: 'br_1',
  title: 'The Keep Leans Closer',
  theme: 'pressure and pacts',
  summary: 'The courier reaches the keep at dusk.',
  keywords: ['Keep'],
}
const RAIN: ChapterDraftRow = {
  id: 'chap_rain',
  branchId: 'br_1',
  title: 'Nine Days of Rain',
  theme: 'patience',
  summary: 'The rain holds the road shut.',
  keywords: ['Rain'],
}
const ROWS = new Map([KEEP, RAIN].map((row) => [row.id, row]))
const NONE_VALUES = chapterDraftFrom(null)

function TitleField({ control }: { control: Control<ChapterDraft> }) {
  const { field } = useController({ control, name: 'title' })
  return <output aria-label="Title">{field.value}</output>
}

const noop = () => {}
const onSave = async () => ({ status: 'ok' as const, id: KEEP.id })

type TimelineProps = { expandedId: string | null; gated: boolean }

/** The route's shape: one session, and each card mounting its own fields as it expands. */
function Timeline({ expandedId, gated }: TimelineProps) {
  const session = useChapterRowSession({
    row: (expandedId == null ? null : ROWS.get(expandedId)) ?? null,
    onSave,
    onSaved: noop,
    onSession: noop,
  })
  return (
    <>
      {[KEEP.id, RAIN.id].map((id) =>
        id === expandedId && (!gated || session.formRowId === id) ? (
          <TitleField key={id} control={session.form.control} />
        ) : null,
      )}
    </>
  )
}

const titleShown = () => screen.getByRole('status', { name: 'Title' }).textContent

afterEach(cleanup)

describe('useChapterRowSession formRowId, on react-hook-form native path', () => {
  // The canary: were react-hook-form on its web path, these fields would read fresh and the test
  // below would pass without the gate.
  it('shows the previous row in a field mounted with the switch, without the gate', () => {
    const view = render(<Timeline expandedId={null} gated={false} />)
    act(() => view.rerender(<Timeline expandedId={KEEP.id} gated={false} />))
    expect(titleShown()).toBe(NONE_VALUES.title)
    act(() => view.rerender(<Timeline expandedId={RAIN.id} gated={false} />))
    expect(titleShown()).toBe(KEEP.title)
  })

  it("shows each opened card's own row, on the first open and on a switch", () => {
    const view = render(<Timeline expandedId={null} gated />)
    act(() => view.rerender(<Timeline expandedId={KEEP.id} gated />))
    expect(titleShown()).toBe(KEEP.title)
    act(() => view.rerender(<Timeline expandedId={RAIN.id} gated />))
    expect(titleShown()).toBe(RAIN.title)
    act(() => view.rerender(<Timeline expandedId={KEEP.id} gated />))
    expect(titleShown()).toBe(KEEP.title)
  })
})
