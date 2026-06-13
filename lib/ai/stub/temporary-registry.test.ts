import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { redactHeaderValue, setHttpCallKnownSecretValues } from '@/lib/diagnostics'

import { getModel } from '../model'
import {
  findTemporaryProvider,
  registerStubProvider,
  resetTemporaryProvidersForTests,
} from './temporary-registry'

const appSettings = vi.hoisted(() => ({ providers: [] as { apiKey: string }[] }))
vi.mock('@/lib/stores', () => ({
  appSettingsStore: { getAppSettings: () => appSettings },
}))

describe('registerStubProvider', () => {
  afterEach(() => {
    resetTemporaryProvidersForTests()
    appSettings.providers = []
    setHttpCallKnownSecretValues([])
  })

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

  it('keeps configured provider keys redacted when the stub registers', () => {
    appSettings.providers = [{ apiKey: 'sk-real-key' }]
    registerStubProvider()
    expect(redactHeaderValue('Bearer sk-real-key')).toBe('***')
    expect(redactHeaderValue('Bearer stub-key')).toBe('***')
  })
})
