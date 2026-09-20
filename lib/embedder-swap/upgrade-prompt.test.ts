import { describe, expect, it } from 'vitest'

import {
  dismissUpgradePrompt,
  embeddingUpgradePromptOpen,
  latchUpgradePrompt,
  UPGRADE_PROMPT_LATCH_INITIAL,
  upgradePromptShown,
  type EmbeddingUpgradePromptInput,
} from './upgrade-prompt'

const OPEN: EmbeddingUpgradePromptInput = {
  storyId: 'story-1',
  storyModelId: 'Xenova/all-MiniLM-L6-v2',
  swapTarget: null,
  declined: null,
  appDefault: 'onnx-community/embeddinggemma-300m-ONNX',
  swapRunning: false,
  deferred: false,
  recoveryActive: false,
}

describe('embeddingUpgradePromptOpen', () => {
  it('opens when the story model differs from a set app default and nothing suppresses it', () => {
    expect(embeddingUpgradePromptOpen(OPEN)).toBe(true)
  })

  it.each<[string, Partial<EmbeddingUpgradePromptInput>]>([
    ['no open story', { storyId: null }],
    ['story model not loaded', { storyModelId: null }],
    // A null declined equals a null default and would close the gate on its own.
    ['app default unset', { appDefault: null, declined: 'some/older-default' }],
    ['app default blank', { appDefault: '   ' }],
    ['same model id', { storyModelId: OPEN.appDefault }],
    ['story on a padded default verbatim', { appDefault: 'onnx/x ', storyModelId: 'onnx/x ' }],
    ['swap marker set (resume prompt owns it)', { swapTarget: 'x' }],
    ['swap running', { swapRunning: true }],
    ['declined this very default', { declined: OPEN.appDefault }],
    ['declined a padded default verbatim', { appDefault: 'onnx/x ', declined: 'onnx/x ' }],
    ['deferred this session', { deferred: true }],
    ['recovery report still open', { recoveryActive: true }],
  ])('stays closed: %s', (_label, override) => {
    expect(embeddingUpgradePromptOpen({ ...OPEN, ...override })).toBe(false)
  })

  it('returns once the default moves to a model the user never declined', () => {
    expect(embeddingUpgradePromptOpen({ ...OPEN, declined: 'some/older-default' })).toBe(true)
  })
})

describe('upgrade prompt latch', () => {
  const opened = (openSeq: number, gateOpen: boolean) =>
    latchUpgradePrompt(UPGRADE_PROMPT_LATCH_INITIAL, openSeq, gateOpen)

  it('never shows before the first open', () => {
    expect(upgradePromptShown(opened(0, true), 0, true)).toBe(false)
  })

  it('shows on an open whose gate is true', () => {
    expect(upgradePromptShown(opened(1, true), 1, true)).toBe(true)
  })

  it('does not carry a prompt into an open it has not latched', () => {
    expect(upgradePromptShown(opened(1, true), 2, true)).toBe(false)
  })

  it('stays hidden when the gate opens later in the same open', () => {
    // The app default moved mid-session: the new question waits for the next open.
    const latch = latchUpgradePrompt(opened(1, false), 1, true)
    expect(upgradePromptShown(latch, 1, true)).toBe(false)
  })

  it('hides when the gate closes while shown', () => {
    // Keep wrote the declined key.
    expect(upgradePromptShown(opened(1, true), 1, false)).toBe(false)
  })

  it('stays dismissed for the rest of the open with the gate still true', () => {
    const latch = latchUpgradePrompt(dismissUpgradePrompt(opened(1, true)), 1, true)
    expect(upgradePromptShown(latch, 1, true)).toBe(false)
  })

  it('re-reads the gate on the next open', () => {
    const dismissed = dismissUpgradePrompt(opened(1, true))
    expect(upgradePromptShown(latchUpgradePrompt(dismissed, 2, true), 2, true)).toBe(true)
    const closedAtOpen = latchUpgradePrompt(latchUpgradePrompt(opened(1, true), 2, false), 2, true)
    expect(upgradePromptShown(closedAtOpen, 2, true)).toBe(false)
  })

  it('returns the same latch object while nothing changes', () => {
    const latch = opened(1, true)
    expect(latchUpgradePrompt(latch, 1, false)).toBe(latch)
    const dismissed = dismissUpgradePrompt(latch)
    expect(dismissUpgradePrompt(dismissed)).toBe(dismissed)
  })
})
