import type { DiscoveryProvider, DiscoveryCard, SearchOptions, SearchResult } from './types'
import { ChubProvider } from './providers/chub'
import { JannyProvider } from './providers/janny'
import { BackyardProvider } from './providers/backyard'
import { CharacterTavernProvider } from './providers/characterTavern'
import { RisuRealmProvider } from './providers/risuRealm'
import { WyvernProvider } from './providers/wyvern'
import { PygmalionProvider } from './providers/pygmalion'
import { MlpchagProvider } from './providers/mlpchag'
import { QuillGenProvider } from './providers/quillgen'

export type { DiscoveryProvider, DiscoveryCard, SearchOptions, SearchResult }
export { METADATA_ONLY_CHARACTER_MIME } from './types'

// Track pagination state per provider for "Search All" mode
interface ProviderPaginationState {
  nextPage: number
  hasMore: boolean
}

export class DiscoveryService {
  private providers: Map<string, DiscoveryProvider> = new Map()
  private allModeState: Map<string, ProviderPaginationState> = new Map()
  private lastAllModeOptions:
    | (Omit<SearchOptions, 'page' | 'limit'> & {
        type: 'character' | 'lorebook' | 'scenario'
      })
    | null = null

  constructor(
    providers: DiscoveryProvider[] = [
      new ChubProvider(),
      new JannyProvider(),
      new BackyardProvider(),
      new CharacterTavernProvider(),
      new RisuRealmProvider(),
      new WyvernProvider(),
      new PygmalionProvider(),
      new MlpchagProvider(),
      new QuillGenProvider(),
    ],
  ) {
    for (const provider of providers) this.registerProvider(provider)
  }

  registerProvider(provider: DiscoveryProvider): void {
    this.providers.set(provider.id, provider)
    console.log(`[Discovery] Registered provider: ${provider.name}`)
  }

  getProvider(id: string): DiscoveryProvider | undefined {
    return this.providers.get(id)
  }

  getProviders(type?: 'character' | 'lorebook' | 'scenario'): DiscoveryProvider[] {
    const all = Array.from(this.providers.values())
    if (!type) return all
    return all.filter((p) => p.supports.includes(type))
  }

  async search(
    providerId: string,
    options: SearchOptions,
    type: 'character' | 'lorebook' | 'scenario',
  ): Promise<SearchResult> {
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }
    if (!provider.supports.includes(type)) {
      throw new Error(`Provider ${providerId} does not support ${type}`)
    }
    return provider.search(options, type)
  }

  /**
   * Search all providers in parallel and aggregate results
   * Resets pagination state for fresh search
   */
  async searchAll(
    options: SearchOptions,
    type: 'character' | 'lorebook' | 'scenario',
  ): Promise<SearchResult> {
    const providers = this.getProviders(type)

    // Reset pagination state for new search
    this.allModeState.clear()
    const { page: _page, limit: _limit, ...stableOptions } = options
    this.lastAllModeOptions = { ...stableOptions, type }

    // Search all providers in parallel
    const results = await Promise.allSettled(
      providers.map((provider) => provider.search({ ...options, page: 1 }, type)),
    )

    // Aggregate successful results and track pagination state
    const allCards: DiscoveryCard[] = []
    let anyHasMore = false

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const provider = providers[i]

      if (result.status === 'fulfilled') {
        allCards.push(...result.value.cards)

        // Track pagination state for this provider
        this.allModeState.set(provider.id, {
          nextPage: result.value.nextPage || 2,
          hasMore: result.value.hasMore,
        })

        if (result.value.hasMore) {
          anyHasMore = true
        }
      } else {
        console.warn('[Discovery] Provider search failed:', result.reason)
        // Mark as no more results for failed providers
        this.allModeState.set(provider.id, { nextPage: 1, hasMore: false })
      }
    }

    // Sort combined results by downloads (most popular first)
    allCards.sort((a, b) => {
      const aDownloads = a.stats?.downloads || 0
      const bDownloads = b.stats?.downloads || 0
      return bDownloads - aDownloads
    })

    return {
      cards: allCards,
      hasMore: anyHasMore,
      nextPage: 2, // Not used directly, but indicates we can load more
    }
  }

  /**
   * Load more results from all providers that still have results
   */
  async loadMoreAll(
    type: 'character' | 'lorebook' | 'scenario',
    limit: number = 48,
  ): Promise<SearchResult> {
    if (!this.lastAllModeOptions || this.lastAllModeOptions.type !== type) {
      return { cards: [], hasMore: false }
    }

    const providers = this.getProviders(type)
    const providersWithMore = providers.filter((p) => {
      const state = this.allModeState.get(p.id)
      return state?.hasMore
    })

    if (providersWithMore.length === 0) {
      return { cards: [], hasMore: false }
    }

    // Fetch next page from all providers that have more
    const results = await Promise.allSettled(
      providersWithMore.map((provider) => {
        const state = this.allModeState.get(provider.id)!
        return provider.search(
          {
            query: this.lastAllModeOptions!.query,
            tags: this.lastAllModeOptions!.tags,
            sort: this.lastAllModeOptions!.sort,
            nsfw: this.lastAllModeOptions!.nsfw,
            page: state.nextPage,
            limit,
          },
          type,
        )
      }),
    )

    // Aggregate results and update pagination state
    const allCards: DiscoveryCard[] = []
    let anyHasMore = false

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const provider = providersWithMore[i]

      if (result.status === 'fulfilled') {
        allCards.push(...result.value.cards)

        // Update pagination state
        this.allModeState.set(provider.id, {
          nextPage: result.value.nextPage || this.allModeState.get(provider.id)!.nextPage + 1,
          hasMore: result.value.hasMore,
        })

        if (result.value.hasMore) {
          anyHasMore = true
        }
      } else {
        console.warn('[Discovery] Provider load more failed:', result.reason)
        // Mark as no more results on failure
        const currentState = this.allModeState.get(provider.id)
        if (currentState) {
          this.allModeState.set(provider.id, { ...currentState, hasMore: false })
        }
      }
    }

    // Also check remaining providers for hasMore
    for (const provider of providers) {
      const state = this.allModeState.get(provider.id)
      if (state?.hasMore) {
        anyHasMore = true
        break
      }
    }

    // Sort combined results by downloads
    allCards.sort((a, b) => {
      const aDownloads = a.stats?.downloads || 0
      const bDownloads = b.stats?.downloads || 0
      return bDownloads - aDownloads
    })

    return {
      cards: allCards,
      hasMore: anyHasMore,
    }
  }

  async downloadCard(card: DiscoveryCard): Promise<Blob> {
    const provider = this.providers.get(card.source)
    if (!provider) {
      throw new Error(`Provider not found: ${card.source}`)
    }
    return provider.downloadCard(card)
  }

  /**
   * Get tags from a specific provider
   */
  async getTags(providerId: string): Promise<string[]> {
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }
    return provider.getTags()
  }

  async getCardDetails(card: DiscoveryCard): Promise<DiscoveryCard> {
    const provider = this.providers.get(card.source)
    if (!provider) {
      // If provider not found or doesn't support fetching details, return original card
      return card
    }

    if (provider.getCardDetails) {
      return provider.getCardDetails(card)
    }

    return card
  }

  /**
   * Get tags from all providers (combined and deduplicated)
   */

  async getAllTags(type?: 'character' | 'lorebook' | 'scenario'): Promise<string[]> {
    const providers = this.getProviders(type)

    // Fetch tags from all providers in parallel
    const results = await Promise.allSettled(providers.map((provider) => provider.getTags()))

    // Combine and deduplicate
    const tagSet = new Set<string>()
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const tag of result.value) {
          tagSet.add(tag)
        }
      }
    }

    // Return sorted array
    return Array.from(tagSet).sort()
  }
}

// Singleton instance
export const discoveryService = new DiscoveryService()
