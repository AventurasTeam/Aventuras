import { describe, expect, it } from 'vitest'
import { decideClose, type CloseSource, type CloseState } from './actionModalClose'

const idle: CloseState = { busy: false, cancelWhileBusy: false, dirty: false, questionOpen: false }
const OWN_EXITS: CloseSource[] = ['cancel', 'escape', 'outside']

describe('decideClose', () => {
  it('closes an untouched modal on every way out', () => {
    for (const source of OWN_EXITS) {
      expect(decideClose(source, idle)).toBe('close')
    }
  })

  it('asks before an edited modal closes', () => {
    for (const source of OWN_EXITS) {
      expect(decideClose(source, { ...idle, dirty: true })).toBe('ask')
    }
  })

  it('treats an outside click exactly as Cancel in every state', () => {
    const states: CloseState[] = [
      idle,
      { ...idle, dirty: true },
      { ...idle, busy: true },
      { ...idle, busy: true, cancelWhileBusy: true },
      { ...idle, busy: true, cancelWhileBusy: true, dirty: true },
    ]
    for (const state of states) {
      expect(decideClose('outside', state)).toBe(decideClose('cancel', state))
    }
  })

  it('holds a running modal open without asking', () => {
    const busy = { ...idle, busy: true, dirty: true }
    for (const source of OWN_EXITS) expect(decideClose(source, busy)).toBe('ignore')
  })

  it('lets Cancel stop a running action when the modal offers it', () => {
    const running = { ...idle, busy: true, cancelWhileBusy: true }
    expect(decideClose('cancel', running)).toBe('close')
  })

  it('closes only the question on Escape or an outside click', () => {
    const asking = { ...idle, dirty: true, questionOpen: true }
    expect(decideClose('escape', asking)).toBe('closeQuestion')
    expect(decideClose('outside', asking)).toBe('closeQuestion')
    expect(decideClose('cancel', asking)).toBe('ignore')
  })
})
