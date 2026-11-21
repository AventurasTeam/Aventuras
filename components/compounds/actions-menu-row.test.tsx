// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActionsMenuRow } from './actions-menu-row'

// This project resolves react-native to RN Web, so the native branch needs its platform pinned.
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<{ Platform: object }>()
  return { ...rn, Platform: { ...rn.Platform, OS: 'android' } }
})

// Stubbed: it ships JSX the unit bundler can't load, and no Text here takes asChild.
vi.mock('@rn-primitives/slot', () => ({ Slot: null }))

const REASON = 'Generation is in flight. Cancel to edit.'

afterEach(cleanup)

function row(data: { disabled?: boolean; disabledReason?: string }) {
  return render(
    <ActionsMenuRow
      row={{ id: 'close', data: { label: 'Close chapter…', onActivate: () => {}, ...data } }}
    />,
  )
}

describe('ActionsMenuRow on native', () => {
  it("shows a disabled entry's reason as a line under its label", () => {
    row({ disabled: true, disabledReason: REASON })
    expect(screen.getByText('Close chapter…')).toBeTruthy()
    expect(screen.getByText(REASON)).toBeTruthy()
  })

  it('shows no line while the entry is enabled', () => {
    row({ disabledReason: REASON })
    expect(screen.queryByText(REASON)).toBeNull()
  })
})
