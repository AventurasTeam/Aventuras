import { describe, it, expect } from 'vitest'
import { advancedPanelView, type AdvancedPanelSettings } from './advancedPanelView'

const view = (overrides: AdvancedPanelSettings = {}) => advancedPanelView(overrides)

describe('advancedPanelView — defaults', () => {
  it('treats absent settings as the shipped defaults, not as off', () => {
    // The panel renders before the settings store has loaded, and an unconfigured install
    // has no stored value at all. Reading either as "off" would show a user a panel
    // claiming their features are disabled when they are running.
    const v = view()

    expect(v.memoryOn).toBe(true)
    expect(v.memoryMode).toBe('static')
    expect(v.entryLLMOn).toBe(true)
    expect(v.worldStateLLMOn).toBe(true)
    expect(v.styleReviewerOn).toBe(true)
    expect(v.grepOn).toBe(false)
  })

  it('marks nothing inactive when everything is on', () => {
    expect(view().inactive).toEqual({
      maxTier3Entries: undefined,
      llmThreshold: undefined,
    })
  })
})

describe('advancedPanelView — inactive controls', () => {
  it('deactivates Max LLM-Selected Entries when Entry Retrieval selection is off', () => {
    const v = view({ entryRetrieval: { enableLLMSelection: false } })

    expect(v.inactive.maxTier3Entries).toBe(
      'LLM Selection is off; the leftover is included whole or not at all',
    )
    // The other section is untouched: it has its own switch.
    expect(v.inactive.worldStateMaxTier3).toBeUndefined()
  })

  it('deactivates the World State selection cap, but never the budget', () => {
    const v = view({ worldStateInjection: { enableLLMSelection: false } })

    // The cap applies only to what the model chose, so with selection off it does nothing.
    expect(v.inactive.worldStateMaxTier3).toBe(
      'LLM Selection is off; the leftover is included whole or not at all',
    )
    expect(v.inactive.maxTier3Entries).toBeUndefined()
  })

  it('reports the Style Reviewer as off, so its controls can be hidden rather than dimmed', () => {
    expect(view({ styleReviewer: { enabled: false } }).styleReviewerOn).toBe(false)
    expect(view({ styleReviewer: { enabled: true } }).styleReviewerOn).toBe(true)
    // Defaults to on when the setting has never been written.
    expect(view({}).styleReviewerOn).toBe(true)
  })

  it('keeps the Recent Entries Window live when LLM selection is off', () => {
    // It still drives Tier 2 matching, so dimming it would be wrong -- only its
    // description narrows.
    const v = view({ entryRetrieval: { enableLLMSelection: false } })

    expect(v.help.entryRecentEntries).toBe(
      'Recent story entries scanned for Tier 2 name/keyword matching',
    )
    expect(v.help.entryRecentEntries).not.toContain('Tier 3')
  })

  it('mentions the Tier 3 prompt only while Tier 3 can run', () => {
    expect(view().help.entryRecentEntries).toContain('Tier 3 selection prompt')
    expect(view().help.worldStateRecentEntries).toContain('Tier 3 selection prompt')
    expect(
      view({ worldStateInjection: { enableLLMSelection: false } }).help.worldStateRecentEntries,
    ).not.toContain('Tier 3')
  })
})

describe('advancedPanelView — grep availability', () => {
  it('is on only in agentic mode', () => {
    const enabled = { agenticRetrieval: { grepEnabled: true } }

    expect(view({ ...enabled, timelineFill: { enabled: true, mode: 'agentic' } }).grepOn).toBe(true)
    expect(view({ ...enabled, timelineFill: { enabled: true, mode: 'static' } }).grepOn).toBe(false)
  })

  it('is off when memory retrieval is off entirely, whatever the stored flag says', () => {
    const v = view({
      agenticRetrieval: { grepEnabled: true },
      timelineFill: { enabled: false, mode: 'agentic' },
    })

    expect(v.grepOn).toBe(false)
  })
})

describe('advancedPanelView — header badges', () => {
  it('names the active memory mode', () => {
    expect(view({ timelineFill: { enabled: true, mode: 'agentic' } }).badges.memory).toEqual({
      text: 'Agentic',
      muted: false,
    })
    expect(view({ timelineFill: { enabled: true, mode: 'static' } }).badges.memory).toEqual({
      text: 'Static',
      muted: false,
    })
  })

  it('mutes the badge when a section is off or reduced', () => {
    expect(view({ timelineFill: { enabled: false } }).badges.memory).toEqual({
      text: 'Off',
      muted: true,
    })
    expect(view({ entryRetrieval: { enableLLMSelection: false } }).badges.entryRetrieval).toEqual({
      text: 'Keywords only',
      muted: true,
    })
    expect(view({ worldStateInjection: { enableLLMSelection: false } }).badges.worldState).toEqual({
      text: 'Names only',
      muted: true,
    })
  })

  it('shows no Style Reviewer badge while it is running', () => {
    // A badge on every section in every state would stop carrying information.
    expect(view().badges.styleReviewer).toBeUndefined()
    expect(view({ styleReviewer: { enabled: false } }).badges.styleReviewer).toEqual({
      text: 'Off',
      muted: true,
    })
  })
})
