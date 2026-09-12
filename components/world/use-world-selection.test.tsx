// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Entity, Lore } from '@/lib/db'
import type { WorldCategory } from '@/lib/list-modules'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'

import { useWorldSelection } from './use-world-selection'

const KAEL = makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' })
const VEIL = makeLore({ id: 'lore_veil', title: 'The Veil' })

type ProbeProps = {
  entities?: Entity[]
  lore?: Lore[]
  category?: WorldCategory
  ready?: boolean
  initialId?: string | null
}

let latest: ReturnType<typeof useWorldSelection> | null = null

function Probe({
  entities = [],
  lore = [],
  category = 'character',
  ready = true,
  initialId = null,
}: ProbeProps) {
  latest = useWorldSelection({ initialId, category, entities, lore, ready })
  return null
}

afterEach(() => {
  cleanup()
  latest = null
})

describe('useWorldSelection', () => {
  it('keeps a deep-link id while the rows hydrate, then resolves it', () => {
    const { rerender } = render(<Probe ready={false} initialId="char_kael" />)
    expect(latest?.selectedId).toBe('char_kael')
    expect(latest?.selection).toBeNull()
    rerender(<Probe entities={[KAEL]} initialId="char_kael" />)
    expect(latest?.selection).toEqual({ type: 'entity', row: KAEL })
  })

  // An undo or a reversed run can remove the row; a redo restores it under the same id.
  it('drops a selection whose row disappears, so its return does not reselect it', () => {
    const { rerender } = render(<Probe entities={[KAEL]} />)
    act(() => latest?.setSelectedId('char_kael'))
    expect(latest?.selection?.row).toBe(KAEL)
    rerender(<Probe entities={[]} />)
    expect(latest?.selectedId).toBeNull()
    rerender(<Probe entities={[KAEL]} />)
    expect(latest?.selection).toBeNull()
  })

  it('clears a deep-link id that never resolves once the rows are in', () => {
    render(<Probe entities={[KAEL]} initialId="char_missing" />)
    expect(latest?.selectedId).toBeNull()
  })

  it("resolves only the current category's rows", () => {
    render(<Probe entities={[KAEL]} lore={[VEIL]} category="lore" initialId="lore_veil" />)
    expect(latest?.selection).toEqual({ type: 'lore', row: VEIL })
    cleanup()
    render(<Probe entities={[KAEL]} category="location" initialId="char_kael" />)
    expect(latest?.selection).toBeNull()
    expect(latest?.selectedId).toBeNull()
  })
})
