// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Entity, Lore } from '@/lib/db'
import type { WorldCategory } from '@/lib/list-modules'

import { useWorldSelection } from './use-world-selection'

function character(id: string, name: string): Entity {
  return {
    id,
    branchId: 'br_1',
    kind: 'character',
    name,
    description: '',
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function loreRow(id: string, title: string): Lore {
  return {
    id,
    branchId: 'br_1',
    title,
    body: '',
    category: 'history',
    tags: [],
    keywords: [],
    injectionMode: 'auto',
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

const KAEL = character('char_kael', 'Kael')
const VEIL = loreRow('lore_veil', 'The Veil')

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
    expect(latest?.selection).toEqual({ category: 'character', row: KAEL })
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
    expect(latest?.selection).toEqual({ category: 'lore', row: VEIL })
    cleanup()
    render(<Probe entities={[KAEL]} category="location" initialId="char_kael" />)
    expect(latest?.selection).toBeNull()
    expect(latest?.selectedId).toBeNull()
  })
})
