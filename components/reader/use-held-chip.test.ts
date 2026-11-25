// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { BranchChipView } from './branch-navigator'
import { useHeldChip } from './use-held-chip'

const THREE: BranchChipView = { count: 3, currentName: 'Main' }
const TWO: BranchChipView = { count: 2, currentName: 'Main' }
const ONE: BranchChipView = { count: 1, currentName: 'Main' }

type Props = { chip: BranchChipView | null; open: boolean }

function setup(initialProps: Props) {
  return renderHook(({ chip, open }: Props) => useHeldChip(chip, open), { initialProps })
}

describe('useHeldChip', () => {
  it('follows the live chip while the navigator is closed', () => {
    const { result, rerender } = setup({ chip: TWO, open: false })
    expect(result.current).toBe(TWO)
    rerender({ chip: ONE, open: false })
    expect(result.current).toBe(ONE)
  })

  it('holds the chip from the render that opens the navigator', () => {
    const { result, rerender } = setup({ chip: TWO, open: false })
    rerender({ chip: TWO, open: true })
    expect(result.current).toBe(TWO)
  })

  it('keeps the chip the navigator opened with while the rows change under it', () => {
    const { result, rerender } = setup({ chip: TWO, open: false })
    rerender({ chip: TWO, open: true })
    rerender({ chip: ONE, open: true })
    expect(result.current).toBe(TWO)
  })

  it('takes the live chip once the navigator closes', () => {
    const { result, rerender } = setup({ chip: TWO, open: false })
    rerender({ chip: TWO, open: true })
    rerender({ chip: ONE, open: true })
    rerender({ chip: ONE, open: false })
    expect(result.current).toBe(ONE)
  })

  it('follows the live chip while a navigator opened with none stays open', () => {
    const { result, rerender } = setup({ chip: null, open: false })
    rerender({ chip: null, open: true })
    rerender({ chip: TWO, open: true })
    expect(result.current).toBe(TWO)
    rerender({ chip: ONE, open: true })
    expect(result.current).toBe(ONE)
  })

  it('latches afresh on the next open', () => {
    const { result, rerender } = setup({ chip: THREE, open: true })
    rerender({ chip: TWO, open: true })
    expect(result.current).toBe(THREE)
    rerender({ chip: TWO, open: false })
    rerender({ chip: TWO, open: true })
    rerender({ chip: ONE, open: true })
    expect(result.current).toBe(TWO)
  })
})
