/**
 * WorldStateTranslationService - Handles translation of world state entities.
 * Extracts from ActionInput.svelte translateWorldStateElements() logic.
 */

import type { Character, Location, Item, StoryBeat, VisualDescriptors } from '#lib/types/index.ts'
import type { UITranslationItem } from '#lib/services/ai/utils/TranslationService.ts'
import { createLogger } from '#lib/log.ts'
import { sameValue } from '#lib/services/stateTracking/index.ts'
import { DESCRIPTOR_CATEGORIES } from '#lib/utils/visualDescriptors.ts'

const log = createLogger('WorldStateTranslationService')

/** New entities from classification result. */
export interface ClassificationNewEntities {
  newCharacters: Array<{
    name: string
    description?: string
    relationship?: string
    traits?: string[]
    visualDescriptors?: Record<string, string>
  }>
  newLocations: Array<{ name: string; description?: string }>
  newItems: Array<{ name: string; description?: string }>
  newStoryBeats: Array<{ title: string; description?: string }>
}

/** Current world state entities for matching. */
export interface WorldStateEntities {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
}

/** Callbacks for persisting translations. */
export interface WorldStateTranslationCallbacks {
  updateCharacter: (id: string, data: Partial<Character>) => Promise<void>
  /** The character as it is now; a translation is not written over text that changed since. */
  getCharacter?: (id: string) => Character | undefined
  updateLocation: (id: string, data: Record<string, string | null>) => Promise<void>
  updateItem: (id: string, data: Record<string, string | null>) => Promise<void>
  updateStoryBeat: (id: string, data: Record<string, string | null>) => Promise<void>
  refreshWorldState: () => Promise<void>
}

export interface WorldStateTranslationDependencies {
  translateUIElements: (
    items: UITranslationItem[],
    targetLanguage: string,
    storyId: string | undefined,
  ) => Promise<UITranslationItem[]>
}

export interface WorldStateTranslationInput {
  /** Story whose pack supplies the translation template. */
  storyId: string
  classificationResult: ClassificationNewEntities
  worldState: WorldStateEntities
  targetLanguage: string
  /**
   * Existing characters the classifier updated, as stored after it. A rewrite drops a field's
   * translation, so each field with text and no translation is translated.
   */
  updatedCharacters?: Character[]
}

export interface WorldStateTranslationResult {
  translatedCount: number
}

type EntityType = 'character' | 'location' | 'item' | 'storyBeat'

type TranslatedField =
  | 'translatedName'
  | 'translatedDescription'
  | 'translatedTitle'
  | 'translatedRelationship'
  | 'translatedTraits'
  | 'translatedVisualDescriptors'

interface TranslationItem extends UITranslationItem {
  entityType: EntityType
  entityId: string
  field: TranslatedField
  /** For traits, translated one per item: the trait's index. */
  trait?: number
  /** For appearance, translated one category per item: the category. */
  category?: keyof VisualDescriptors
  /** Whether a character still holds the text this item was made from. */
  stillCurrent?: (c: Character) => boolean
}

interface TranslatedPart {
  item: TranslationItem
  text: string
}

export class WorldStateTranslationService {
  constructor(private deps: WorldStateTranslationDependencies) {}

  async translateEntities(
    input: WorldStateTranslationInput,
    callbacks: WorldStateTranslationCallbacks,
  ): Promise<WorldStateTranslationResult> {
    const { storyId, classificationResult, worldState, targetLanguage } = input
    const items: TranslationItem[] = []

    // Characters are translated from their stored rows. An updated one only where a field has
    // no translation, and first, so a name the classifier also listed as new keeps its own text.
    const queued = new Set<string>()
    const queueCharacter = (char: Character, onlyMissing: boolean) => {
      if (queued.has(char.id)) return
      queued.add(char.id)
      items.push(...characterItems(char, onlyMissing))
    }
    for (const char of input.updatedCharacters ?? []) queueCharacter(char, true)
    for (const char of classificationResult.newCharacters) {
      const db = worldState.characters.find((c) => c.name === char.name)
      if (db) queueCharacter(db, false)
    }

    // Collect location fields
    for (const loc of classificationResult.newLocations) {
      const db = worldState.locations.find((l) => l.name === loc.name)
      if (!db) continue
      items.push({
        id: `${db.id}:name`,
        entityId: db.id,
        text: loc.name,
        type: 'name',
        entityType: 'location',
        field: 'translatedName',
      })
      if (loc.description)
        items.push({
          id: `${db.id}:desc`,
          entityId: db.id,
          text: loc.description,
          type: 'description',
          entityType: 'location',
          field: 'translatedDescription',
        })
    }

    // Collect item fields
    for (const item of classificationResult.newItems) {
      const db = worldState.items.find((i) => i.name === item.name)
      if (!db) continue
      items.push({
        id: `${db.id}:name`,
        entityId: db.id,
        text: item.name,
        type: 'name',
        entityType: 'item',
        field: 'translatedName',
      })
      if (item.description)
        items.push({
          id: `${db.id}:desc`,
          entityId: db.id,
          text: item.description,
          type: 'description',
          entityType: 'item',
          field: 'translatedDescription',
        })
    }

    // Collect story beat fields
    for (const beat of classificationResult.newStoryBeats) {
      const db = worldState.storyBeats.find((b) => b.title === beat.title)
      if (!db) continue
      items.push({
        id: `${db.id}:title`,
        entityId: db.id,
        text: beat.title,
        type: 'title',
        entityType: 'storyBeat',
        field: 'translatedTitle',
      })
      if (beat.description)
        items.push({
          id: `${db.id}:desc`,
          entityId: db.id,
          text: beat.description,
          type: 'description',
          entityType: 'storyBeat',
          field: 'translatedDescription',
        })
    }

    if (items.length === 0) return { translatedCount: 0 }

    log('Translating world state elements', { count: items.length, targetLanguage })
    const translated = await this.deps.translateUIElements(
      items.map(({ id, text, type }) => ({ id, text, type })),
      targetLanguage,
      storyId,
    )

    // One write per field. A field translated in parts (traits, appearance) is written only
    // whole, and a character's only while it still holds the text that was sent.
    const fieldKey = (i: TranslationItem) => `${i.entityId} ${i.field}`
    const fields = new Map<string, { expected: number; parts: TranslatedPart[] }>()
    for (const item of items) {
      const group = fields.get(fieldKey(item))
      if (group) group.expected++
      else fields.set(fieldKey(item), { expected: 1, parts: [] })
    }
    const byId = new Map(items.map((i) => [i.id, i]))
    for (const t of translated) {
      const item = byId.get(t.id)
      if (item) fields.get(fieldKey(item))?.parts.push({ item, text: t.text })
    }

    for (const { expected, parts } of fields.values()) {
      if (parts.length === 0 || parts.length !== expected) continue
      const { entityType, entityId, field } = parts[0].item

      if (entityType === 'character') {
        const current = callbacks.getCharacter?.(entityId)
        if (callbacks.getCharacter && !current) continue
        if (current && parts.some(({ item }) => item.stillCurrent && !item.stillCurrent(current)))
          continue
        await callbacks.updateCharacter(entityId, {
          [field]: assemble(field, parts),
          translationLanguage: targetLanguage,
        })
        continue
      }
      const data = { [field]: parts[0].text, translationLanguage: targetLanguage }
      if (entityType === 'location') await callbacks.updateLocation(entityId, data)
      else if (entityType === 'item') await callbacks.updateItem(entityId, data)
      else if (entityType === 'storyBeat') await callbacks.updateStoryBeat(entityId, data)
    }

    await callbacks.refreshWorldState()
    log('World state elements translated', { count: translated.length })
    return { translatedCount: translated.length }
  }
}

// Traits and appearance go one trait or category per item, so a comma inside one cannot split
// it and the appearance comes back as categories.
function characterItems(char: Character, onlyMissing: boolean): TranslationItem[] {
  const items: TranslationItem[] = []
  const wanted = (translation: unknown) => !onlyMissing || !translation
  const add = (
    field: TranslatedField,
    key: string,
    text: string,
    stillCurrent: (c: Character) => boolean,
    part: Pick<TranslationItem, 'trait' | 'category'> = {},
  ) =>
    items.push({
      id: `${char.id}:${key}`,
      text,
      type: field === 'translatedName' ? 'name' : 'description',
      entityType: 'character',
      entityId: char.id,
      field,
      stillCurrent,
      ...part,
    })

  if (char.name && wanted(char.translatedName))
    add('translatedName', 'name', char.name, (c) => c.name === char.name)
  if (char.description && wanted(char.translatedDescription))
    add(
      'translatedDescription',
      'desc',
      char.description,
      (c) => c.description === char.description,
    )
  if (char.relationship && wanted(char.translatedRelationship))
    add(
      'translatedRelationship',
      'rel',
      char.relationship,
      (c) => c.relationship === char.relationship,
    )
  if (wanted(char.translatedTraits)) {
    const sameTraits = (c: Character) => sameValue(c.traits, char.traits)
    ;(char.traits ?? []).forEach((text, trait) =>
      add('translatedTraits', `trait:${trait}`, text, sameTraits, { trait }),
    )
  }
  if (wanted(char.translatedVisualDescriptors)) {
    const sameLook = (c: Character) => sameValue(c.visualDescriptors, char.visualDescriptors)
    for (const category of DESCRIPTOR_CATEGORIES) {
      const value = char.visualDescriptors?.[category]
      if (value?.trim())
        add('translatedVisualDescriptors', `visual:${category}`, value, sameLook, { category })
    }
  }
  return items
}

function assemble(
  field: TranslatedField,
  parts: TranslatedPart[],
): string | string[] | VisualDescriptors {
  switch (field) {
    case 'translatedTraits':
      return parts.toSorted((a, b) => (a.item.trait ?? 0) - (b.item.trait ?? 0)).map((p) => p.text)
    case 'translatedVisualDescriptors': {
      const look: VisualDescriptors = {}
      for (const { item, text } of parts) if (item.category) look[item.category] = text
      return look
    }
    default:
      return parts[0].text
  }
}
