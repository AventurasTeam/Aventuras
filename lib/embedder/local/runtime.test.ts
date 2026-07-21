import { describe, expect, it } from 'vitest'

import { envelopeToError } from './runtime'
import { EmbedderCallError, EmbedderInitError } from '../types'

describe('envelopeToError', () => {
  it('maps kind "init" to EmbedderInitError, preserving the message', () => {
    const error = envelopeToError({ kind: 'init', message: 'session never came up' })
    expect(error).toBeInstanceOf(EmbedderInitError)
    expect(error.message).toBe('session never came up')
  })

  it('maps kind "call" to EmbedderCallError, preserving the message', () => {
    const error = envelopeToError({ kind: 'call', message: 'run failed' })
    expect(error).toBeInstanceOf(EmbedderCallError)
    expect(error.message).toBe('run failed')
  })
})
