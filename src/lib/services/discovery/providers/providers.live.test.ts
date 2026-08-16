import { describe, expect, it, vi } from 'vitest'
import { discoveryService } from '../index'

vi.mock('../utils', () => ({
  // Provider production code uses Tauri HTTP; live Node tests use the platform fetch equivalent.
  corsFetch: (url: string, options?: RequestInit) => globalThis.fetch(url, options),
  GENERIC_ICON: 'generic-icon',
}))

const live = process.env.AVENTURAS_LIVE_DISCOVERY === '1'

describe.skipIf(!live)('discovery providers live smoke', () => {
  // Build the matrix from the registry so adding a provider automatically adds a live contract.
  it.each(
    discoveryService
      .getProviders('character')
      .map((provider) => [provider.name, provider] as const),
  )(
    '%s finds and downloads a public character',
    async (_name, provider) => {
      const result = await provider.search(
        { query: '', page: 1, limit: 1, sort: 'popular', nsfw: false },
        'character',
      )
      const card = result.cards[0]

      expect(card, `${provider.name} returned no public characters`).toBeDefined()
      expect(card.id).toBeTruthy()
      expect(card.name).toBeTruthy()
      expect(card.source).toBe(provider.id)
      expect(await provider.getDownloadUrl(card)).toBeTruthy()

      const blob = await provider.downloadCard(card)
      expect(blob.size).toBeGreaterThan(0)
      expect(blob.type).toBeTruthy()
    },
    30_000,
  )
})
