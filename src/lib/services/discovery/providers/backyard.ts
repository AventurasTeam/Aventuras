import type { DiscoveryCard, DiscoveryProvider, SearchOptions, SearchResult } from '../types'
import { corsFetch } from '../utils'

const BACKYARD_API_BASE = 'https://backyard.ai/api/trpc'

export class BackyardProvider implements DiscoveryProvider {
  id = 'backyard'
  name = 'Backyard.ai'
  icon = 'https://backyard.ai/favicon.png'
  supports: ('character' | 'lorebook' | 'scenario')[] = ['character', 'scenario']

  async search(
    options: SearchOptions,
    type: 'character' | 'lorebook' | 'scenario',
  ): Promise<SearchResult> {
    if (type === 'lorebook') {
      return { cards: [], hasMore: false }
    }

    const sortMap: Record<string, string> = {
      popular: 'Popularity',
      new: 'New',
      name: 'Popularity', // Backyard doesn't have name sort exposed in browse? Fallback to popular
    }

    // Construct tRPC input
    // If query is present, we use the search behavior (which in Bot Browser uses getHubGroupConfigsForTag with search param)
    // Actually Bot Browser uses hub.browse.getHubGroupConfigsForTag for both browse and search

    const input: any = {
      tagNames: options.tags || [],
      sortBy: {
        type: sortMap[options.sort || 'popular'] || 'Popularity',
        direction: 'desc',
      },
      // Backyard now uses this field for chat topology, not content sensitivity.
      type: 'all',
      direction: 'forward',
    }

    if (options.query) {
      input.search = options.query.trim()
    }

    // Pagination: Aventura uses page numbers, Backyard uses cursor.
    // Since Aventura's searchAll logic is page-based (1, 2, 3...), we have a mismatch.
    // However, Aventura's DiscoveryService seems to store state for "Search All" but for individual provider search it passes page numbers.
    // Since we can't easily map page number to cursor without state, and the DiscoveryService creates a new instance of provider?
    // No, DiscoveryService is a singleton and registers instances. So I can store state in the provider instance?
    // But search requests might come in parallel or out of order.
    // For now, let's look at how Bot Browser handles it. It tracks cursor in state.
    // If Aventura passes page=1, we reset. If page > 1, we rely on cached cursor?
    // This is tricky. Aventura's interface assumes stateless page-based pagination or that the provider handles state mapping.
    // A hacky way is to ignore page number if it's just incrementing, and use internal cursor.
    // But if the user jumps pages, it breaks.
    // Given the `searchAll` implementation in `index.ts`:
    // `this.allModeState.set(provider.id, { nextPage: result.value.nextPage || 2, ... })`
    // And `loadMoreAll` calls `provider.search({ page: state.nextPage ... })`.
    // So it basically asks for "next page".
    // I will store the `nextCursor` in a map keyed by the query signature to try and support this stateless-ish interface.

    // For simplicity for this task: if page is 1, we send no cursor.
    // If page > 1, we try to use the last stored cursor. This assumes sequential access.

    if (options.page && options.page > 1 && this.lastCursor) {
      input.cursor = this.lastCursor
    }

    const url = this.buildTrpcUrl('hub.browse.getHubGroupConfigsForTag', input)
    console.log('[Backyard] Searching:', url)

    const response = await corsFetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Backyard API error: ${response.status}`)
    }

    const json = await response.json()
    // tRPC batch response: [{ result: { data: { json: ... } } }]
    const data = json[0]?.result?.data?.json

    if (!data) {
      return { cards: [], hasMore: false }
    }

    // Update cursor for next page
    if (data.nextCursor) {
      this.lastCursor = data.nextCursor
    } else {
      this.lastCursor = undefined
    }

    const configs = (data.hubGroupConfigs || []).filter(
      (config: any) =>
        options.nsfw ||
        !(config.isNSFW || config.CharacterConfigs?.some((character: any) => character.isNSFW)),
    )
    const cards = configs.map((c: any) => this.transformCard(c))

    return {
      cards,
      hasMore: !!data.nextCursor,
      nextPage: data.nextCursor ? (options.page || 1) + 1 : undefined,
    }
  }

  private lastCursor?: string

  private buildTrpcUrl(procedure: string, input: any): string {
    const batchInput = { '0': { json: input } }
    const encoded = encodeURIComponent(JSON.stringify(batchInput))
    return `${BACKYARD_API_BASE}/${procedure}?batch=1&input=${encoded}`
  }

  private transformCard(char: any): DiscoveryCard {
    const config = char.CharacterConfigs?.[0] || {}
    const image = config.Images?.[0]

    let avatarUrl = ''
    if (image?.imageUrl) {
      // Use smaller size for thumbnails
      avatarUrl = image.imageUrl.replace('/upload/', '/upload/w_300,c_fill,g_north,f_auto,q_auto/')
    }

    // Extract tags
    const tags = (char.Tags || []).map((t: any) => t.name)

    return {
      id: config.id || char.id, // Use CharacterConfig ID
      name: config.displayName || config.name || char.name || 'Unnamed',
      creator: char.Author?.username || 'Unknown',
      description: char.tagline || '',
      avatarUrl: avatarUrl,
      imageUrl: `https://backyard.ai/hub/character/${char.id}`,
      tags: tags,
      stats: {
        downloads: char.downloadCount || 0,
        // messageCount: char.messageCount || 0
      },
      source: 'backyard',
      type: 'character',
      nsfw: char.isNSFW || config.isNSFW || false,
      raw: {
        ...char,
        groupId: char.id, // Keep group ID for fetching full details if needed
      },
    }
  }

  async getDownloadUrl(card: DiscoveryCard): Promise<string> {
    // Backyard doesn't have a direct download URL for a card file.
    // We would need to generate it.
    // But for the interface, we can return a placeholder or the hub URL.
    return `https://backyard.ai/hub/character/${card.raw?.groupId || card.id}`
  }

  async downloadCard(card: DiscoveryCard): Promise<Blob> {
    // Fetch full character details
    const charId = card.id // This is the Config ID from our transform
    // Note: Bot Browser uses getHubCharacterConfigById with hubCharacterConfigId

    const input = {
      hubCharacterConfigId: charId,
      includeStandaloneGroupConfig: true,
    }

    const url = this.buildTrpcUrl('hub.browse.getHubCharacterConfigById', input)
    const response = await corsFetch(url)

    if (!response.ok) throw new Error(`Failed to fetch card details: ${response.status}`)

    const json = await response.json()
    const charData = json[0]?.result?.data?.json

    if (!charData) throw new Error('Empty response from Backyard API')

    const converted = this.convertToSillyTavern(charData)

    // Create JSON blob
    const blob = new Blob([JSON.stringify(converted, null, 2)], { type: 'application/json' })
    return blob
  }

  private convertToSillyTavern(char: any) {
    const groupConfig = char.standaloneGroupConfig || {}
    const primaryChat = groupConfig.PrimaryChat || {}

    // Greetings
    const greetings = primaryChat.HubGreetingMessages || []
    const firstMessage = greetings[0]?.text || ''
    const alternateGreetings = greetings.slice(1).map((g: any) => g.text)

    // Example messages
    const examples = primaryChat.HubExampleMessages || []
    let mesExample = ''
    if (examples.length > 0) {
      mesExample = examples
        .map((msg: any) => {
          const name = msg.characterName || 'Unknown'
          const text = msg.text || ''
          return `<START>\n${name}: ${text}`
        })
        .join('\n\n')
    }

    // Lorebook
    let characterBook = undefined
    const lorebookItems = char.LorebookItems || []
    if (lorebookItems.length > 0) {
      characterBook = {
        name: `${char.displayName || char.name} Lorebook`,
        entries: lorebookItems.map((item: any, idx: number) => ({
          id: idx + 1,
          keys: [item.key],
          secondary_keys: [],
          content: item.value,
          comment: item.key,
          enabled: true,
          constant: false,
          selective: false,
          insertion_order: 100,
          position: 'before_char',
        })),
      }
    }

    return {
      name: char.displayName || char.name || 'Unnamed',
      description: char.persona || '',
      personality: '',
      scenario: primaryChat.context || '',
      first_mes: firstMessage,
      mes_example: mesExample,
      creator_notes: char.creatorNotes || char.tagline || '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: alternateGreetings,
      character_book: characterBook,
      tags: (char.Tags || []).map((t: any) => t.name),
      creator: char.Author?.username || 'Unknown',
      character_version: '1.0',
      extensions: {
        backyard: {
          id: char.id,
          groupId: groupConfig.id,
        },
      },
    }
  }

  async getTags(): Promise<string[]> {
    // Backyard doesn't seem to have a simple getTags endpoint in the snippets provided.
    // We can return a static list or empty for now.
    return []
  }
}
