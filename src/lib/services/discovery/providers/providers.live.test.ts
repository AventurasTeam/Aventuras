import { describe, expect, it, vi } from 'vitest'
// The aggregate character-card API also loads its AI sanitizer and Svelte stores. Live provider
// tests only need the production file reader/parser and run in a plain Node environment.
// eslint-disable-next-line boundaries/dependencies
import { parseJson } from '$lib/services/characterCardImport/parseJson'
// eslint-disable-next-line boundaries/dependencies
import { readFile } from '$lib/services/characterCardImport/readFile'
import { discoveryService, METADATA_ONLY_CHARACTER_MIME } from '../index'

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

      // Nonempty bytes are not sufficient: validate the payload through the same filename-based
      // PNG/JSON reader and card parser used by Character Vault imports.
      const extension = blob.type.includes('json') ? 'json' : 'png'
      const file = new File([blob], `${card.name}.${extension}`, { type: blob.type })
      const cardJson = await readFile(file)
      const parsed = parseJson(cardJson)

      expect(parsed, `${provider.name} returned an unusable character-card payload`).not.toBeNull()
      expect(parsed?.name, `${provider.name} returned a card without a name`).toBeTruthy()

      const mode = blob.type === METADATA_ONLY_CHARACTER_MIME ? 'metadata-only' : 'full-card'
      console.info(`[Live discovery] ${provider.name}: ${mode}, ${blob.size} bytes`)
    },
    30_000,
  )
})
