import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getModel } from '../model'
import {
  resetTemporaryProvidersForTests,
  setTemporaryProvidersForTests,
} from './temporary-registry'

const stub = {
  id: 'stub-1',
  type: 'stub' as const,
  displayName: 'Stub',
  apiKey: 'stub-key',
  favoriteModelIds: [] as string[],
}

describe('stub provider', () => {
  afterEach(() => {
    resetTemporaryProvidersForTests()
    vi.unstubAllGlobals()
  })

  it('happy scenario routes through the captured fetch and returns the canned reply', async () => {
    setTemporaryProvidersForTests([stub])
    const { text } = await generateText({ model: getModel('stub-1', 'happy'), prompt: 'go' })
    expect(text).toBe('{"reply":"hi"}')
  })

  it('rejects stub creation in production builds', () => {
    vi.stubGlobal('__DEV__', false)
    setTemporaryProvidersForTests([stub])
    expect(() => getModel('stub-1', 'happy')).toThrow(/production/)
  })
})
