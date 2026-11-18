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

// RN Web renders each Text as a dir="auto" element, so an empty line still counts here.
function linesBesideButton(): { before: (string | null)[]; after: (string | null)[] } {
  const pressable = screen.getByRole('button')
  const outside = Array.from(document.querySelectorAll('[dir="auto"]')).filter(
    (el) => !pressable.contains(el),
  )
  const follows = (el: Element) =>
    (pressable.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  return {
    before: outside.filter((el) => !follows(el)).map((el) => el.textContent),
    after: outside.filter(follows).map((el) => el.textContent),
  }
}

describe('ReasonButton on native', () => {
  it("shows a disabled button's reason as a line under it", () => {
    button({ disabled: true, disabledReason: REASON })
    expect(linesBesideButton()).toEqual({ before: [], after: [REASON] })
  })

  it('shows no line for a disabled button without a reason', () => {
    button({ disabled: true })
    expect(linesBesideButton()).toEqual({ before: [], after: [] })
  })

  it('shows no line while the button is enabled', () => {
    button({ disabledReason: REASON })
    expect(linesBesideButton()).toEqual({ before: [], after: [] })
  })
})
