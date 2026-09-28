import { describe, expect, it } from 'vitest'

import { composerModesUnavailableReason, wrapComposerText } from './index'

describe('wrapComposerText', () => {
  it('wraps Do in first person verbatim', () => {
    expect(
      wrapComposerText('reach for the blade', { mode: 'do', pov: 'first', leadName: 'Aria' }),
    ).toBe('I reach for the blade.')
  })

  it('wraps Do in third person with verb conjugation', () => {
    expect(
      wrapComposerText('reach for the blade', { mode: 'do', pov: 'third', leadName: 'Aria' }),
    ).toBe('Aria reaches for the blade.')
  })

  it('wraps Say in first person with capitalized quote', () => {
    expect(wrapComposerText("who's asking?", { mode: 'say', pov: 'first', leadName: 'Aria' })).toBe(
      '"Who\'s asking?" I said.',
    )
  })

  it('wraps Say in third person', () => {
    expect(wrapComposerText("who's asking?", { mode: 'say', pov: 'third', leadName: 'Aria' })).toBe(
      '"Who\'s asking?" Aria said.',
    )
  })

  it('wraps Think in first person without capitalizing', () => {
    expect(
      wrapComposerText('this smells like a trap', {
        mode: 'think',
        pov: 'first',
        leadName: 'Aria',
      }),
    ).toBe('*this smells like a trap* I thought.')
  })

  it('wraps Think in third person', () => {
    expect(
      wrapComposerText('this smells like a trap', {
        mode: 'think',
        pov: 'third',
        leadName: 'Aria',
      }),
    ).toBe('*this smells like a trap* Aria thought.')
  })

  it('sends Free verbatim regardless of pov', () => {
    expect(wrapComposerText('  raw text  ', { mode: 'free', pov: 'first', leadName: 'Aria' })).toBe(
      '  raw text  ',
    )
  })

  it('does not double a trailing period on Do', () => {
    expect(
      wrapComposerText('reach for the blade.', { mode: 'do', pov: 'first', leadName: 'Aria' }),
    ).toBe('I reach for the blade.')
  })
})

describe('composerModesUnavailableReason', () => {
  it('returns the reason for a third-person wrap with no resolved lead', () => {
    expect(composerModesUnavailableReason(true, 'third', null, 'no lead')).toBe('no lead')
  })

  it('returns undefined for a first-person wrap even with no resolved lead', () => {
    expect(composerModesUnavailableReason(true, 'first', null, 'no lead')).toBeUndefined()
  })

  it('returns undefined once the lead resolves', () => {
    expect(composerModesUnavailableReason(true, 'third', 'Aria', 'no lead')).toBeUndefined()
  })

  it('returns undefined when modes are not enabled at all', () => {
    expect(composerModesUnavailableReason(false, 'third', null, 'no lead')).toBeUndefined()
  })
})
