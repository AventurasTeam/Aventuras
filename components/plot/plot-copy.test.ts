import { describe, expect, it, vi } from 'vitest'

import {
  happeningIssueText,
  iconFromOption,
  iconOptionValue,
  plotIconOptions,
  plotMenuEntries,
  saveRejectionText,
} from './plot-copy'

// The real catalog pulls lucide-react-native, which node can't parse.
vi.mock('./plot-icon', () => ({ PLOT_ICON_KEYS: ['sparkles', 'eye'] }))

describe('plot icon options', () => {
  it('never offers an empty value, which Radix Select refuses', () => {
    for (const current of [null, '', 'sparkles', 'lantern']) {
      expect(plotIconOptions(current).map((o) => o.value)).not.toContain('')
    }
  })

  it("keeps a stored key the catalog doesn't know, first after none", () => {
    expect(
      plotIconOptions('lantern')
        .map((o) => o.value)
        .slice(1),
    ).toEqual(['lantern', 'sparkles', 'eye'])
    expect(
      plotIconOptions('sparkles')
        .map((o) => o.value)
        .slice(1),
    ).toEqual(['sparkles', 'eye'])
    expect(
      plotIconOptions('')
        .map((o) => o.value)
        .slice(1),
    ).toEqual(['sparkles', 'eye'])
  })

  it('round-trips none as null and a key as itself', () => {
    const none = plotIconOptions(null)[0]
    expect(none.label).toBe('No icon')
    expect(iconOptionValue(null)).toBe(none.value)
    expect(iconOptionValue('')).toBe(none.value)
    expect(iconFromOption(none.value)).toBeNull()
    expect(iconFromOption(iconOptionValue('eye'))).toBe('eye')
  })
})

describe('saveRejectionText', () => {
  it('names generation in flight, otherwise the generic failure', () => {
    expect(saveRejectionText('in-flight')).toBe(
      "Couldn't save while generation is in flight. Your changes are still here.",
    )
    for (const code of ['failed', 'parent-cycle', 'parent-chain-broken'] as const) {
      expect(saveRejectionText(code)).toBe(
        "Couldn't save your changes. They're still here — try again.",
      )
    }
  })
})

describe('plotMenuEntries', () => {
  it('has no delete entry while there is no row yet', () => {
    const entries = plotMenuEntries('thread', vi.fn())
    expect(entries.find((e) => e.key === 'delete')).toBeUndefined()
  })

  it('disables the delete entry with the given reason', () => {
    const entries = plotMenuEntries('happening', vi.fn(), {
      onDelete: vi.fn(),
      disabledReason: 'Generation is in flight. Cancel to edit.',
    })
    const remove = entries.find((e) => e.key === 'delete')
    expect(remove?.label).toBe('Delete happening')
    expect(remove?.disabled).toBe(true)
    expect(remove?.disabledReason).toBe('Generation is in flight. Cancel to edit.')
  })

  it('enables the delete entry and calls onDelete otherwise', () => {
    const onDelete = vi.fn()
    const entries = plotMenuEntries('thread', vi.fn(), { onDelete })
    const remove = entries.find((e) => e.key === 'delete')
    expect(remove?.label).toBe('Delete thread')
    expect(remove?.disabled).toBe(false)
    remove?.onPress()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('happeningIssueText', () => {
  it('names the tab a link-row issue sits on', () => {
    expect(happeningIssueText('decayRange')).toBe('Awareness: Enter a value from 0 to 1.')
    expect(happeningIssueText('duplicateCharacter')).toBe(
      'Awareness: This character already has an awareness row.',
    )
    expect(happeningIssueText('characterRequired')).toBe('Awareness: Pick a character.')
    expect(happeningIssueText('duplicateEntity')).toBe(
      'Involvements: This entity is already involved.',
    )
    expect(happeningIssueText('entityRequired')).toBe('Involvements: Pick an entity.')
  })

  it('leaves Overview issues and unknown messages as they are', () => {
    expect(happeningIssueText('titleRequired')).toBe('A title is required.')
    expect(happeningIssueText('timeAnchorExclusive')).toBe(
      'Choose a narrative entry or an out-of-narrative time, not both.',
    )
    expect(happeningIssueText('Expected number')).toBe('Expected number')
  })
})
