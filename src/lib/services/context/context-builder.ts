/**
 * ContextBuilder
 *
 * Flat variable store + template renderer. Services add variables
 * via .add(), then render templates via .render(). Variables accumulate
 * across services -- all templates can access all variables.
 *
 * External templates (image styles, lorebook tools) don't use ContextBuilder.
 * Services fetch those directly from the pack and inject data programmatically.
 */

import { database } from '$lib/services/database'
import { templateEngine } from '$lib/services/templates/engine'
import { createLogger } from '$lib/log'
import { story } from '$lib/stores/story/index.svelte'
import type { RenderResult } from './types'
import type { RuntimeVariable, RuntimeVarsMap } from '$lib/services/packs/types'

export interface EntityRuntimeVars {
  name: string
  vars: Array<{ label: string; value: string }>
}

const log = createLogger('ContextBuilder')

export class ContextBuilder {
  private context: Record<string, any> = {}
  private packId: string = 'default-pack'

  constructor(packId?: string) {
    if (packId) this.packId = packId
  }

  /**
   * Merge variables into context. Returns this for chaining.
   */
  add(data: Record<string, any>): this {
    Object.assign(this.context, data)
    return this
  }

  /**
   * Render a template from the active pack through LiquidJS.
   */
  async render(templateId: string): Promise<RenderResult> {
    log('render', { templateId, packId: this.packId })

    const systemTemplate = await database.getPackTemplate(this.packId, templateId)
    if (!systemTemplate) {
      log('WARNING: system template not found', { templateId, packId: this.packId })
    }
    const userTemplate = await database.getPackTemplate(this.packId, `${templateId}-user`)
    if (!userTemplate) {
      log('WARNING: user template not found', {
        templateId: `${templateId}-user`,
        packId: this.packId,
      })
    }

    const systemResult = systemTemplate?.content
      ? templateEngine.render(systemTemplate.content, this.context)
      : ''
    if (systemResult === null) {
      log('ERROR: system template render failed, using raw content', { templateId })
    }
    const userResult = userTemplate?.content
      ? templateEngine.render(userTemplate.content, this.context)
      : ''
    if (userResult === null) {
      log('ERROR: user template render failed, using raw content', { templateId })
    }

    return {
      system: systemResult ?? '',
      user: userResult ?? '',
    }
  }

  /**
   * Get a copy of the current context. Useful for debugging.
   */
  getContext(): Record<string, any> {
    return { ...this.context }
  }

  /**
   * Get the active pack ID.
   */
  getPackId(): string {
    return this.packId
  }

  /**
   * Get runtime variable values from story entities.
   * Each entity type gets a separate variable:
   *   characters, locations, items,
   *   storyBeats, protagonist
   *
   * Format per entity: "EntityName: VarLabel = value, VarLabel = value"
   * Empty string when no runtime variables are defined or no values exist.
   */
  static async getRuntimeVariableContext(
    packId: string,
  ): Promise<Record<string, EntityRuntimeVars[]>> {
    const { characters } = story.character
    const { locations } = story.location
    const { items } = story.item
    const { storyBeats } = story.storyBeat
    const { protagonist } = story.character
    const empty: Record<string, EntityRuntimeVars[]> = {
      characters: [],
      locations: [],
      items: [],
      storyBeats: [],
      protagonist: [],
    }

    try {
      const defs = await database.getRuntimeVariables(packId)
      if (defs.length === 0) return empty

      // Group definitions by entity type for fast lookup
      const defsByType: Record<string, RuntimeVariable[]> = {}
      for (const d of defs) {
        if (!defsByType[d.entityType]) defsByType[d.entityType] = []
        defsByType[d.entityType].push(d)
      }

      const collectEntities = (
        entities: Array<{ name: string; metadata: Record<string, unknown> | null }>,
        entityType: string,
      ): EntityRuntimeVars[] => {
        const typeDefs = defsByType[entityType]
        if (!typeDefs || typeDefs.length === 0) return []

        const result: EntityRuntimeVars[] = []
        for (const entity of entities) {
          const runtimeVars = (entity.metadata as Record<string, unknown> | null)?.runtimeVars as
            | RuntimeVarsMap
            | undefined
          if (!runtimeVars) continue

          const vars: Array<{ label: string; value: string }> = []
          for (const def of typeDefs) {
            const entry = runtimeVars[def.id]
            if (entry && entry.v != null && entry.v !== '') {
              vars.push({ label: def.displayName, value: String(entry.v) })
            }
          }
          if (vars.length > 0) {
            result.push({ name: entity.name, vars })
          }
        }
        return result
      }

      const beatsWithName = storyBeats.map((b) => ({
        name: b.title,
        metadata: b.metadata,
      }))

      const result = {
        characters: collectEntities(characters, 'character'),
        locations: collectEntities(locations, 'location'),
        items: collectEntities(items, 'item'),
        storyBeats: collectEntities(beatsWithName, 'story_beat'),
        protagonist: protagonist ? collectEntities([protagonist], 'character') : [],
      }

      log('getRuntimeVariableContext', {
        packId: packId,
        defCount: defs.length,
        charCount: result.characters.length,
        locCount: result.locations.length,
        itemCount: result.items.length,
        beatCount: result.storyBeats.length,
        hasProtagonist: result.protagonist.length > 0,
      })

      return result
    } catch (error) {
      log('getRuntimeVariableContext failed', { packId: packId, error })
      return empty
    }
  }
}
