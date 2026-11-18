// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Text } from '@/components/ui/text'

import { ReasonButton } from './reason-button'

// This project resolves react-native to RN Web, so the native branch needs its platform pinned.
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<{ Platform: object }>()
  return { ...rn, Platform: { ...rn.Platform, OS: 'android' } }
})
// Stubbed: each ships JSX or Flow the unit bundler can't load, and no button here loads or takes
// asChild.
vi.mock('@rn-primitives/slot', () => ({ Slot: null }))
vi.mock('@/components/ui/spinner', () => ({ Spinner: null }))

const REASON = 'Generation is in flight. Cancel to edit.'

afterEach(cleanup)

function button(props: { disabled?: boolean; disabledReason?: string }) {
  return render(
    <ReasonButton {...props}>
      <Text>Close chapter…</Text>
    </ReasonButton>,
  )
}

// The wrapper holds the button, and the reason line after it when there is one.
const wrapperChildren = (container: HTMLElement) => container.firstElementChild?.children.length

describe('ReasonButton on native', () => {
  it("shows a disabled button's reason as a line under it", () => {
    const { container } = button({ disabled: true, disabledReason: REASON })
    expect(screen.getByText(REASON)).toBeTruthy()
    expect(wrapperChildren(container)).toBe(2)
  })

  it('shows no line for a disabled button without a reason', () => {
    const { container } = button({ disabled: true })
    expect(wrapperChildren(container)).toBe(1)
  })

  it('shows no line while the button is enabled', () => {
    const { container } = button({ disabledReason: REASON })
    expect(screen.queryByText(REASON)).toBeNull()
    expect(wrapperChildren(container)).toBe(1)
  })
})
