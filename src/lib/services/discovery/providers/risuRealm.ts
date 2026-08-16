import type { DiscoveryCard, DiscoveryProvider, SearchOptions, SearchResult } from '../types'
import { corsFetch } from '../utils'

const RISU_BASE_URL = 'https://realm.risuai.net'
const RISU_DATA_URL = `${RISU_BASE_URL}/__data.json`
const RISU_IMAGE_BASE = 'https://sv.risuai.xyz/resource/'

export class RisuRealmProvider implements DiscoveryProvider {
  id = 'risu_realm'
  name = 'RisuRealm'
  icon = 'https://realm.risuai.net/icon.png'
  supports: ('character' | 'lorebook' | 'scenario')[] = ['character', 'scenario']

  async search(
    options: SearchOptions,
    type: 'character' | 'lorebook' | 'scenario',
  ): Promise<SearchResult> {
    if (type === 'lorebook') {
      return { cards: [], hasMore: false }
    }

    const params = new URLSearchParams()

    // Sort
    const sort =
      options.sort === 'new' ? 'date' : options.sort === 'popular' ? 'download' : 'recommended'
    if (sort !== 'recommended') {
      params.set('sort', sort)
    } else {
      params.set('sort', '')
    }

    params.set('page', String(options.page || 1))
    if (options.query) params.set('q', options.query)

    if (options.nsfw === false) {
      params.set('nsfw', 'false')
    }

    // Cache buster
    params.set('_t', Date.now().toString())

    const url = `${RISU_DATA_URL}?${params}`
    console.log('[RisuRealm] Searching:', url)

    const response = await corsFetch(url, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    })

    if (!response.ok) {
      throw new Error(`RisuRealm API error: ${response.status}`)
    }

    const json = await response.json()

    // Navigate to data array - SvelteKit format varies
    let nodeData: any = null

    if (json?.nodes?.[1]?.data) nodeData = json.nodes[1].data
    else if (json?.nodes?.[0]?.data) nodeData = json.nodes[0].data
    else if (json?.data) nodeData = json.data
    else if (Array.isArray(json?.nodes)) {
      for (const node of json.nodes) {
        if (node?.data && Array.isArray(node.data)) {
          nodeData = node.data
          break
        }
      }
    }

    if (!nodeData) {
      console.warn('[RisuRealm] Invalid response format', json)
      return { cards: [], hasMore: false }
    }

    const cards = this.parseDevalueData(nodeData)

    // Pass sorting options to transform to detect mixed content context
    const transformed = cards.map((c) => this.transformCard(c, options.nsfw !== false))

    // Pagination heuristic
    const pageSize = 30
    const hasMore = cards.length >= pageSize

    return {
      cards: transformed,
      hasMore,
      nextPage: hasMore ? (options.page || 1) + 1 : undefined,
    }
  }

  private parseDevalueData(data: any[]): any[] {
    const cards: any[] = []
    if (!data || !Array.isArray(data) || data.length < 3) return cards

    // data[1] is array of card indexes
    const cardIndexes = data[1]
    if (!Array.isArray(cardIndexes)) return cards

    const resolveValue = (val: any): any => {
      if (Array.isArray(val)) {
        return val.map((idx) => {
          if (typeof idx === 'number' && data[idx] !== undefined) return data[idx]
          return idx
        })
      }
      return val
    }

    for (const startIndex of cardIndexes) {
      try {
        const schema = data[startIndex]
        if (!schema || typeof schema !== 'object') continue

        const card: any = {}
        for (const [key, valueIndex] of Object.entries(schema)) {
          if (typeof valueIndex === 'number' && data[valueIndex] !== undefined) {
            card[key] = resolveValue(data[valueIndex])
          } else {
            card[key] = valueIndex
          }
        }

        if (card.id && card.name) {
          cards.push(card)
        }
      } catch (e) {
        console.warn('Error parsing Risu card:', e)
      }
    }
    return cards
  }

  private transformCard(card: any, askedForSensitive: boolean = false): DiscoveryCard {
    const tags = Array.isArray(card.tags) ? card.tags : []

    // Parse downloads
    let downloads = 0
    if (typeof card.download === 'string') {
      const match = card.download.match(/^([\d.]+)k?$/i)
      if (match) {
        downloads = parseFloat(match[1]) * (card.download.toLowerCase().includes('k') ? 1000 : 1)
      }
    } else if (typeof card.download === 'number') {
      downloads = card.download
    }

    return {
      id: card.id,
      name: card.name || 'Unnamed',
      creator: card.authorname || 'Unknown',
      description: card.desc || '',
      avatarUrl: card.img ? `${RISU_IMAGE_BASE}${card.img}` : '',
      imageUrl: `${RISU_BASE_URL}/character/${card.id}`,
      tags,
      stats: {
        downloads,
      },
      source: 'risu_realm',
      type: 'character',
      // If we asked for mixed content, we must label unlabeled items as NSFW to be safe
      nsfw: askedForSensitive,
      raw: card,
    }
  }

  async getDownloadUrl(card: DiscoveryCard): Promise<string> {
    return `${RISU_BASE_URL}/character/${card.id}`
  }

  async downloadCard(card: DiscoveryCard): Promise<Blob> {
    const url = `${RISU_BASE_URL}/character/${card.id}/__data.json`
    const response = await corsFetch(url)
    if (!response.ok) throw new Error(`Failed to fetch character details: ${response.status}`)

    const json = await response.json()
    const nodeData = json?.nodes?.[1]?.data

    if (!nodeData || !Array.isArray(nodeData)) throw new Error('Invalid character data')

    // Parse single character data (similar to list but for one item)
    // First element is metadata, second is schema
    const cardSchema = nodeData[1]
    if (!cardSchema || typeof cardSchema !== 'object') throw new Error('Invalid schema')

    const fullCard: any = {}
    for (const [key, valueIndex] of Object.entries(cardSchema)) {
      if (typeof valueIndex === 'number' && nodeData[valueIndex] !== undefined) {
        let val = nodeData[valueIndex]
        if (Array.isArray(val)) {
          val = val.map((idx) => {
            if (typeof idx === 'number' && nodeData[idx] !== undefined) return nodeData[idx]
            return idx
          })
        }
        fullCard[key] = val
      } else {
        fullCard[key] = valueIndex
      }
    }

    // Risu's decoded page data uses SillyTavern-compatible field names when the
    // author exposes them. Preserve those fields instead of reducing the card to metadata.
    const stCard = {
      name: fullCard.name,
      description: fullCard.desc || '',
      personality: fullCard.personality || '',
      scenario: fullCard.scenario || '',
      first_mes: fullCard.first_mes || '',
      mes_example: fullCard.mes_example || '',
      creator_notes: fullCard.creator_notes || '',
      tags: fullCard.tags || [],
      creator: fullCard.authorname,
      character_version: '1.0',
      extensions: {
        risu_realm: { id: card.id },
      },
    }

    const blob = new Blob([JSON.stringify(stCard, null, 2)], { type: 'application/json' })
    return blob
  }

  async getTags(): Promise<string[]> {
    return []
  }
}
