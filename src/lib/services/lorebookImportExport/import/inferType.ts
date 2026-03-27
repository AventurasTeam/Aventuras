/**
 * Entry type inference based on keyword matching
 */
import type { EntryType } from '$lib/types'

const TYPE_KEYWORDS: Record<EntryType, string[]> = {
  character: [
    'character',
    'person',
    'npc',
    'protagonist',
    'antagonist',
    'villain',
    'hero',
    'he is',
    'she is',
    'they are',
    'personality',
    'appearance',
    'occupation',
    'age:',
    'gender:',
    'species:',
    'race:',
    'class:',
  ],
  location: [
    'location',
    'place',
    'area',
    'region',
    'city',
    'town',
    'village',
    'building',
    'room',
    'forest',
    'mountain',
    'ocean',
    'river',
    'located in',
    'found at',
    'geography',
    'terrain',
    'climate',
  ],
  item: [
    'item',
    'weapon',
    'armor',
    'tool',
    'artifact',
    'object',
    'equipment',
    'potion',
    'scroll',
    'key',
    'contains',
    'grants',
    'provides',
    'equip',
  ],
  faction: [
    'faction',
    'organization',
    'guild',
    'group',
    'clan',
    'tribe',
    'kingdom',
    'empire',
    'alliance',
    'order',
    'members',
    'leader',
    'founded',
  ],
  concept: [
    'concept',
    'magic',
    'system',
    'rule',
    'lore',
    'history',
    'tradition',
    'technology',
    'science',
    'religion',
    'culture',
    'custom',
    'law',
  ],
  event: [
    'event',
    'war',
    'battle',
    'ceremony',
    'festival',
    'disaster',
    'catastrophe',
    'happened',
    'occurred',
    'took place',
    'anniversary',
    'historical',
  ],
}

export function inferEntryType(name: string, content: string): EntryType {
  const textToAnalyze = `${name} ${content}`.toLowerCase()

  const scores: Record<EntryType, number> = {
    character: 0,
    location: 0,
    item: 0,
    faction: 0,
    concept: 0,
    event: 0,
  }

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS) as [EntryType, string[]][]) {
    for (const keyword of keywords) {
      if (textToAnalyze.includes(keyword)) {
        scores[type]++
      }
    }
  }

  let maxType: EntryType = 'concept'
  let maxScore = 0

  for (const [type, score] of Object.entries(scores) as [EntryType, number][]) {
    if (score > maxScore) {
      maxScore = score
      maxType = type
    }
  }

  return maxType
}
