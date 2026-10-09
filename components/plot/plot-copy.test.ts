import { describe, expect, it, vi } from 'vitest'

import {
  happeningIssueText,
  iconFromOption,
  iconOptionValue,
  importFailureText,
  importRejectionText,
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
  it('names generation in flight and a row gone, otherwise the generic failure', () => {
    expect(saveRejectionText('in-flight')).toBe(
      "Couldn't save while generation is in flight. Your changes are still here.",
    )
    expect(saveRejectionText('not-found')).toBe("Couldn't save: this row no longer exists.")
    expect(saveRejectionText('failed')).toBe(
      "Couldn't save your changes. They're still here — try again.",
    )
  })
})

describe('import failure copy', () => {
  it("names generation in flight, otherwise the generic failure, and doesn't claim kept changes", () => {
    expect(importRejectionText('in-flight')).toBe(
      "Couldn't import while generation is in flight. Try again when it finishes.",
    )
    expect(importRejectionText('failed')).toBe("Couldn't import that file. Try again.")
    expect(importFailureText()).toBe("Couldn't import that file. Try again.")
  })
})

describe('plotMenuEntries', () => {
  const actions = () => ({ onViewJson: vi.fn(), onExport: vi.fn() })

  it('offers a live Export and View raw JSON, and no Delete while there is no row yet', () => {
    const entries = plotMenuEntries('thread', actions())
    expect(entries.map((e) => [e.key, e.label, e.disabled ?? false, e.disabledReason])).toEqual([
      ['export', 'Export thread as JSON', false, undefined],
      ['json', 'View raw JSON', false, undefined],
    ])
  })

  it('routes Export and View raw JSON to their own handlers', () => {
    const handlers = actions()
    const entries = plotMenuEntries('happening', handlers)
    const exportEntry = entries.find((e) => e.key === 'export')
    expect(exportEntry?.label).toBe('Export happening as JSON')
    exportEntry?.onPress()
    expect(handlers.onExport).toHaveBeenCalledTimes(1)
    expect(handlers.onViewJson).not.toHaveBeenCalled()
    entries.find((e) => e.key === 'json')?.onPress()
    expect(handlers.onViewJson).toHaveBeenCalledTimes(1)
    expect(handlers.onExport).toHaveBeenCalledTimes(1)
  })

  it('disables the delete entry with the given reason', () => {
    const entries = plotMenuEntries('happening', {
      ...actions(),
      remove: { onDelete: vi.fn(), disabledReason: 'Generation is in flight. Cancel to edit.' },
    })
    const remove = entries.find((e) => e.key === 'delete')
    expect(remove?.label).toBe('Delete happening')
    expect(remove?.disabled).toBe(true)
    expect(remove?.disabledReason).toBe('Generation is in flight. Cancel to edit.')
  })

  it('enables the delete entry and calls onDelete otherwise', () => {
    const onDelete = vi.fn()
    const entries = plotMenuEntries('thread', { ...actions(), remove: { onDelete } })
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
