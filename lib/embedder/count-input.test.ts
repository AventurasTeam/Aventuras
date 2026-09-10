import { beforeEach, describe, expect, it, vi } from 'vitest'

import { countEmbedderTokens } from './count-input'
import { countTokensLocal } from './local/runtime'
import type { EmbedderConfig } from './types'

vi.mock('./local/runtime', () => ({ countTokensLocal: vi.fn() }))

const local: EmbedderConfig = { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', dim: 384 }
const provider: EmbedderConfig = {
  backend: 'provider',
  providerId: 'p1',
  modelId: 'text-embedding-3-small',
  dim: null,
  truncation: null,
}
// Deliberately unlike any real tokenizer, so a test cannot pass by coincidence.
const estimate = (text: string) => text.length * 7

describe('countEmbedderTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the local tokenizer and reports the count as exact', async () => {
    vi.mocked(countTokensLocal).mockResolvedValue([13, 21])

    await expect(countEmbedderTokens(local, ['a', 'bb'], estimate)).resolves.toEqual({
      counts: [13, 21],
      exact: true,
    })
  })

  // A provider has no tokenizer, so the estimate is the only answer — never as exact.
  it('estimates for a provider, and says the count is not exact', async () => {
    await expect(countEmbedderTokens(provider, ['ab'], estimate)).resolves.toEqual({
      counts: [14],
      exact: false,
    })
    expect(countTokensLocal).not.toHaveBeenCalled()
  })

  // A fresh app has nothing installed; a vanished counter reads as a broken field.
  it('falls back to the estimate when the local tokenizer cannot load', async () => {
    vi.mocked(countTokensLocal).mockRejectedValue(new Error('no model installed'))

    await expect(countEmbedderTokens(local, ['ab'], estimate)).resolves.toEqual({
      counts: [14],
      exact: false,
    })
  })

  it('answers an empty request without consulting either counter', async () => {
    await expect(countEmbedderTokens(local, [], estimate)).resolves.toEqual({
      counts: [],
      exact: true,
    })
    expect(countTokensLocal).not.toHaveBeenCalled()
  })
})
