import { generateText } from 'ai'
import { afterEach, describe, expect, it } from 'vitest'

import { getModel } from '../model'
import {
  findTemporaryProvider,
  registerStubProvider,
  resetTemporaryProvidersForTests,
} from './temporary-registry'

describe('registerStubProvider', () => {
  afterEach(() => resetTemporaryProvidersForTests())

  it('registers a runtime-resolvable stub provider', async () => {
    const id = registerStubProvider()
    const { text } = await generateText({ model: getModel(id, 'happy'), prompt: 'go' })
    expect(text).toBe('{"reply":"hi"}')
  })

  it('is idempotent', () => {
    const first = registerStubProvider()
    const second = registerStubProvider()
    expect(first).toBe(second)
    expect(findTemporaryProvider(first)).toBeDefined()
  })
})
