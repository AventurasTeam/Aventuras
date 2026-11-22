import { describe, expect, it } from 'vitest'

import { attempt, messageOf } from './thrown'

describe('messageOf', () => {
  it("reads an Error's own message, without its class name", () => {
    expect(messageOf(new TypeError('bad input'))).toBe('bad input')
  })

  it('stringifies anything else thrown', () => {
    expect(messageOf('plain')).toBe('plain')
    expect(messageOf(42)).toBe('42')
    expect(messageOf(undefined)).toBe('undefined')
  })
})

describe('attempt', () => {
  it('returns the value of a run that resolves', async () => {
    expect(await attempt(() => Promise.resolve(7))).toStrictEqual({ ok: true, value: 7 })
  })

  it('returns what a rejecting run threw, as is', async () => {
    const error = new Error('refused')
    const result = await attempt(() => Promise.reject(error))
    expect(result).toStrictEqual({ ok: false, error })
    if (!result.ok) expect(result.error).toBe(error)
  })

  it('catches a run that throws before it returns a promise', async () => {
    const result = await attempt<number>(() => {
      throw new Error('sync')
    })
    expect(result.ok).toBe(false)
  })
})
