/**
 * WorldStateTranslationService - Handles translation of world state entities.
 * Extracts from ActionInput.svelte translateWorldStateElements() logic.
 */

import type { Character, Location, Item, StoryBeat } from '$lib/types'
import type { UITranslationItem } from '$lib/services/ai/utils/TranslationService'
import { hasDescriptors, descriptorsToString } from '$lib/utils/visualDescriptors'
import { story } from '$lib/stores/story/index.svelte'
import { aiService } from '../ai'
import { database } from '../database'
import { settings } from '$lib/stores/settings.svelte'

function log(...args: unknown[]) {
  console.log('[WorldStateTranslationService]', ...args)
}

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

export interface WorldStateTranslationResult {
  translatedCount: number
}

type EntityType = 'character' | 'location' | 'item' | 'storyBeat'

interface TranslationItem extends UITranslationItem {
  entityType: EntityType
  field: string
  isArray?: boolean
}

export class WorldStateTranslationService {
  async translateEntities(): Promise<WorldStateTranslationResult> {
    const targetLanguage = settings.translationSettings.targetLanguage
    const result = story.generationContext.classificationResult?.classificationResult
    const classificationResult = {
      newCharacters: result?.entryUpdates.newCharacters || [],
      newLocations: result?.entryUpdates.newLocations || [],
      newItems: result?.entryUpdates.newItems || [],
      newStoryBeats: result?.entryUpdates.newStoryBeats || [],
    }

    const worldState = {
      characters: story.character.characters,
      locations: story.location.locations,
      items: story.item.items,
      storyBeats: story.storyBeat.storyBeats,
    }

    const items: TranslationItem[] = []

    // Collect character fields
    for (const char of classificationResult.newCharacters) {
      const db = worldState.characters.find((c) => c.name === char.name)
      if (!db) continue
      items.push({
        id: `${db.id}:name`,
        text: char.name,
        type: 'name',
        entityType: 'character',
        field: 'translatedName',
      })
      if (char.description)
        items.push({
          id: `${db.id}:desc`,
          text: char.description,
          type: 'description',
          entityType: 'character',
          field: 'translatedDescription',
        })
      if (char.relationship)
        items.push({
          id: `${db.id}:rel`,
          text: char.relationship,
          type: 'description',
          entityType: 'character',
          field: 'translatedRelationship',
        })
      if (char.traits?.length)
        items.push({
          id: `${db.id}:traits`,
          text: char.traits.join(', '),
          type: 'description',
          entityType: 'character',
          field: 'translatedTraits',
          isArray: true,
        })
      if (hasDescriptors(char.visualDescriptors))
        items.push({
          id: `${db.id}:visual`,
          text: descriptorsToString(char.visualDescriptors),
          type: 'description',
          entityType: 'character',
          field: 'translatedVisualDescriptors',
        })
    }

    // Collect location fields
    for (const loc of classificationResult.newLocations) {
      const db = worldState.locations.find((l) => l.name === loc.name)
      if (!db) continue
      items.push({
        id: `${db.id}:name`,
        text: loc.name,
        type: 'name',
        entityType: 'location',
        field: 'translatedName',
      })
      if (loc.description)
        items.push({
          id: `${db.id}:desc`,
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
        text: item.name,
        type: 'name',
        entityType: 'item',
        field: 'translatedName',
      })
      if (item.description)
        items.push({
          id: `${db.id}:desc`,
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
        text: beat.title,
        type: 'title',
        entityType: 'storyBeat',
        field: 'translatedTitle',
      })
      if (beat.description)
        items.push({
          id: `${db.id}:desc`,
          text: beat.description,
          type: 'description',
          entityType: 'storyBeat',
          field: 'translatedDescription',
        })
    }

    if (items.length === 0) return { translatedCount: 0 }

    log('Translating world state elements', { count: items.length, targetLanguage })
    story.generationContext.uiElementsToTranslate = items.map(({ id, text, type }) => ({
      id,
      text,
      type,
    }))
    const translated = await aiService.translateUIElements()

    // Apply translations
    for (const t of translated) {
      const [entityId] = t.id.split(':')
      const orig = items.find((i) => i.id === t.id)
      if (!orig) continue

      const value = orig.isArray
        ? t.text
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : t.text
      const data: Record<string, string | string[] | null> = {
        [orig.field]: value,
        translationLanguage: targetLanguage,
      }

      if (orig.entityType === 'character') await database.updateCharacter(entityId, data)
      else if (orig.entityType === 'location')
        await database.updateLocation(entityId, data as Record<string, string | null>)
      else if (orig.entityType === 'item')
        await database.updateItem(entityId, data as Record<string, string | null>)
      else if (orig.entityType === 'storyBeat')
        await database.updateStoryBeat(entityId, data as Record<string, string | null>)
    }

    await story.refreshWorldState()
    log('World state elements translated', { count: translated.length })
    return { translatedCount: translated.length }
  }
}
