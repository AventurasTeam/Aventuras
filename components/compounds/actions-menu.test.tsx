// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SearchableOverlayListProps } from '@/components/ui/searchable-overlay-list'

import { ActionsMenu } from './actions-menu'
import type { ActionsMenuRowData } from './actions-menu-row'

const captured = vi.hoisted(() => ({
  props: null as SearchableOverlayListProps<ActionsMenuRowData> | null,
}))
vi.mock('@/components/ui/searchable-overlay-list', () => ({
  SearchableOverlayList: (p: SearchableOverlayListProps<ActionsMenuRowData>) => {
    captured.props = p
    return null
  },
}))
// Stubbed: nothing renders them under the list stub, and their imports don't load in the unit bundler.
vi.mock('@/components/ui/icon-action', () => ({ IconAction: () => null }))
vi.mock('@/components/ui/text', () => ({ Text: () => null }))
vi.mock('./actions-menu-row', () => ({ ActionsMenuRow: () => null }))
vi.mock('lucide-react-native', () => ({ MoreVertical: null }))

afterEach(cleanup)

describe('ActionsMenu', () => {
  it("hands an entry's opensSheet to its row and leaves the others unset", () => {
    render(
      <ActionsMenu
        contextual={{
          id: 'here',
          header: 'On this screen',
          entries: [
            { id: 'browse', label: 'Browse', opensSheet: true, onActivate: () => {} },
            { id: 'jump', label: 'Jump', onActivate: () => {} },
          ],
        }}
        coreGroups={[]}
      />,
    )
    const rows = captured.props?.sections[0]?.rows ?? []
    expect(rows.map((row) => [row.id, row.opensSheet === true])).toEqual([
      ['browse', true],
      ['jump', false],
    ])
  })
})
