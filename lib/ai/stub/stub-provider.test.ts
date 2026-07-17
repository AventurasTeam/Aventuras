import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getModel } from '../model'
import { resetTestProviders, setTestProviders } from './test-provider-registry'

const stub = {
  id: 'stub-1',
  type: 'stub' as const,
  displayName: 'Stub',
  apiKey: 'stub-key',
  favoriteModelIds: [] as string[],
}

describe('stub provider', () => {
  afterEach(() => {
    resetTestProviders()
    vi.unstubAllGlobals()
  })

  it('happy scenario routes through the captured fetch and returns the canned reply', async () => {
    setTestProviders([stub])
    const { text } = await generateText({ model: getModel('stub-1', 'happy'), prompt: 'go' })
    expect(text).toBe('{"reply":"hi"}')
  })

  it('rejects stub creation in production builds', () => {
    vi.stubGlobal('__DEV__', false)
    setTestProviders([stub])
    expect(() => getModel('stub-1', 'happy')).toThrow(/production/)
  })
})
