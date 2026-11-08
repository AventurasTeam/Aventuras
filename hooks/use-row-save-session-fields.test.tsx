// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useMemo } from 'react'
import { useController, type Control } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { useCreateResetTab } from './use-create-reset-tab'
import { useRowSaveSession } from './use-row-save-session'

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

const schema = z.object({ body: z.string(), priority: z.string() })
type Draft = z.infer<typeof schema>
type Row = Draft & { id: string }
type Tab = 'body' | 'settings'

const resolver = zodResolver(schema)
const BLANK: Draft = { body: '', priority: '' }
const ALPHA: Row = { id: 'row_alpha', body: 'Alpha body', priority: 'high' }
const BETA: Row = { id: 'row_beta', body: 'Beta body', priority: 'low' }

function Field({ control, name }: { control: Control<Draft>; name: keyof Draft }) {
  const { field } = useController({ control, name })
  return <output aria-label={name}>{field.value}</output>
}

const label = (text: string) => text
const failureText = () => 'failed'
const commit = async () => ({ status: 'ok' as const })

type PaneProps = { row: Row | null; createSeq?: number; gated: boolean }

/** World's and Plot's shape: a row opens on Settings, a `[+] Blank` create lands on Body. */
function Pane({ row, createSeq, gated }: PaneProps) {
  const values = useMemo<Draft>(
    () => (row == null ? BLANK : { body: row.body, priority: row.priority }),
    [row],
  )
  const session = useRowSaveSession<Draft>({
    rowKey: row?.id ?? `create:${createSeq ?? 0}`,
    values,
    resolver,
    fieldLabel: label,
    issueText: label,
    failureText,
    commit,
  })
  const [tab] = useCreateResetTab<Tab>(createSeq, 'body', 'settings')
  if (gated && !session.formHoldsRow) return null
  const { control } = session.form
  return tab === 'body' ? (
    <Field key="body" control={control} name="body" />
  ) : (
    <Field key="priority" control={control} name="priority" />
  )
}

const shown = (name: keyof Draft) => screen.getByRole('status', { name }).textContent

afterEach(cleanup)

describe('useRowSaveSession formHoldsRow, on react-hook-form native path', () => {
  // The canary: were react-hook-form on its web path, the create tab would read blank here and the
  // gated test below would pass without the gate.
  it('shows the previous row in a create tab mounted with the switch, without the gate', () => {
    const view = render(<Pane row={ALPHA} gated={false} />)
    act(() => view.rerender(<Pane row={null} createSeq={1} gated={false} />))
    expect(shown('body')).toBe(ALPHA.body)
  })

  it("shows a create's blanks on the tab the create opens", () => {
    const view = render(<Pane row={ALPHA} gated />)
    expect(shown('priority')).toBe(ALPHA.priority)
    act(() => view.rerender(<Pane row={null} createSeq={1} gated />))
    expect(shown('body')).toBe('')
  })

  it('shows the next row in a tab that stays open across a row switch', () => {
    const view = render(<Pane row={ALPHA} gated />)
    act(() => view.rerender(<Pane row={BETA} gated />))
    expect(shown('priority')).toBe(BETA.priority)
  })
})
