import { describe, expect, it, vi } from 'vitest'

import { buildStoryToolsGroup } from './story-tools-group'

const REASON = 'Generation is in flight. Cancel to edit.'

describe('buildStoryToolsGroup', () => {
  it('gives no group when the open region holds no reply to end on', () => {
    const openCloseModal = vi.fn()
    expect(
      buildStoryToolsGroup({
        branchId: 'br_1',
        canClose: false,
        gateReason: undefined,
        openCloseModal,
      }),
    ).toBeUndefined()
    // Capability outranks the gate: a run in flight doesn't bring a dead entry back.
    expect(
      buildStoryToolsGroup({
        branchId: 'br_1',
        canClose: false,
        gateReason: REASON,
        openCloseModal,
      }),
    ).toBeUndefined()
    expect(openCloseModal).not.toHaveBeenCalled()
  })

  it('opens the close modal on the branch, with no end picked', () => {
    const openCloseModal = vi.fn()
    const group = buildStoryToolsGroup({
      branchId: 'br_1',
      canClose: true,
      gateReason: undefined,
      openCloseModal,
    })
    expect(group?.id).toBe('story-tools')
    expect(group?.header).toBe('Story tools')
    expect(group?.entries.map((e) => [e.id, e.label, e.disabled, e.disabledReason])).toEqual([
      ['close-chapter', 'Close chapter…', false, undefined],
    ])
    expect(openCloseModal).not.toHaveBeenCalled()
    group?.entries[0]?.onActivate()
    expect(openCloseModal).toHaveBeenCalledExactlyOnceWith({ branchId: 'br_1' })
  })

  it('disables Close chapter… with the gate reason while a run holds it', () => {
    const group = buildStoryToolsGroup({
      branchId: 'br_1',
      canClose: true,
      gateReason: REASON,
      openCloseModal: vi.fn(),
    })
    expect(group?.entries).toHaveLength(1)
    expect(group?.entries[0]).toMatchObject({
      id: 'close-chapter',
      disabled: true,
      disabledReason: REASON,
    })
  })
})
