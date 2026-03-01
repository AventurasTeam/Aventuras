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
import { createLogger } from '$lib/services/ai/core/config'
import type { RenderResult } from './types'
import type { Character, Location, Item, StoryBeat } from '$lib/types'
import type { RuntimeVariable, RuntimeVarsMap } from '$lib/services/packs/types'

const log = createLogger('ContextBuilder')

export class ContextBuilder {
  private context: Record<string, any> = {}
  private packId: string = 'default-pack'

  constructor(packId?: string) {
    if (packId) this.packId = packId
  }

  /**
   * Convenience factory: create a ContextBuilder pre-populated from a story.
   * Loads story settings, protagonist, location, time, and pack custom variables.
   */
  static async forStory(storyId: string, packIdOverride?: string): Promise<ContextBuilder> {
    const story = await database.getStory(storyId)
    if (!story) {
      log('forStory: story not found', { storyId })
      return new ContextBuilder()
    }

    const packId = packIdOverride || (await database.getStoryPackId(storyId)) || 'default-pack'
    const builder = new ContextBuilder(packId)

    // Load story data into context
    builder.add({
      mode: story.mode || 'adventure',
      pov: story.settings?.pov || 'second',
      tense: story.settings?.tense || 'present',
      genre: story.genre || '',
      tone: story.settings?.tone || '',
      themes: story.settings?.themes?.join(', ') || '',
      settingDescription: story.description || '',
      visualProseMode: story.settings?.visualProseMode || false,
      inlineImageMode: story.settings?.imageGenerationMode === 'inline',
    })

    // Protagonist
    const characters = await database.getCharacters(storyId)
    const protagonist = characters.find((c) => c.relationship === 'self')
    builder.add({
      protagonistName: protagonist?.name || 'the protagonist',
      protagonistDescription: protagonist?.description || '',
    })

    // Current location
    const locations = await database.getLocations(storyId)
    const currentLocation = locations.find((l) => l.current)
    builder.add({ currentLocation: currentLocation?.name || '' })

    // Story time
    if (story.timeTracker) {
      const t = story.timeTracker
      builder.add({
        storyTime: `Year ${t.years + 1}, Day ${t.days + 1}, ${t.hours} hours ${t.minutes} minutes`,
      })
    }

    // Pack custom variable defaults
    await builder.loadCustomVariables()

    // Override pack variable defaults with story-specific values
    const storyVarValues = await database.getStoryCustomVariables(story.id)
    if (storyVarValues) {
      builder.add(storyVarValues)
    }

    // Runtime variable values from entities
    const items = await database.getItems(storyId)
    const storyBeats = await database.getStoryBeats(storyId)
    await builder.loadRuntimeVariableContext(characters, locations, items, storyBeats, protagonist)

    log('forStory complete', {
      storyId,
      packId,
      contextKeys: Object.keys(builder.context).length,
      storyVarOverrides: storyVarValues ? Object.keys(storyVarValues).length : 0,
    })
    return builder
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
      system: systemResult ?? systemTemplate?.content ?? '',
      user: userResult ?? userTemplate?.content ?? '',
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
   * Load custom variable defaults from the active pack.
   * Only sets variables not already in context.
   */
  private async loadCustomVariables(): Promise<void> {
    try {
      const variables = await database.getPackVariables(this.packId)
      for (const v of variables) {
        if (!(v.variableName in this.context)) {
          this.context[v.variableName] = v.defaultValue ?? ''
        }
      }
    } catch (error) {
      log('loadCustomVariables failed', { packId: this.packId, error })
    }
  }

  /**
   * Load runtime variable values from story entities and add formatted text blocks
   * to the context. Each entity type gets a separate variable:
   *   runtimeVars_characters, runtimeVars_locations, runtimeVars_items,
   *   runtimeVars_storyBeats, runtimeVars_protagonist
   *
   * Format per entity: "EntityName: VarLabel = value, VarLabel = value"
   * Empty string when no runtime variables are defined or no values exist.
   */
  private async loadRuntimeVariableContext(
    characters: Character[],
    locations: Location[],
    items: Item[],
    storyBeats: StoryBeat[],
    protagonist: Character | undefined,
  ): Promise<void> {
    try {
      const defs = await database.getRuntimeVariables(this.packId)
      if (defs.length === 0) {
        this.add({
          runtimeVars_characters: '',
          runtimeVars_locations: '',
          runtimeVars_items: '',
          runtimeVars_storyBeats: '',
          runtimeVars_protagonist: '',
        })
        return
      }

      // Group definitions by entity type for fast lookup
      const defsByType: Record<string, RuntimeVariable[]> = {}
      for (const d of defs) {
        if (!defsByType[d.entityType]) defsByType[d.entityType] = []
        defsByType[d.entityType].push(d)
      }

      const formatEntities = (
        entities: Array<{ name: string; metadata: Record<string, unknown> | null }>,
        entityType: string,
      ): string => {
        const typeDefs = defsByType[entityType]
        if (!typeDefs || typeDefs.length === 0) return ''

        const lines: string[] = []
        for (const entity of entities) {
          const runtimeVars = (entity.metadata as Record<string, unknown> | null)?.runtimeVars as
            | RuntimeVarsMap
            | undefined
          if (!runtimeVars) continue

          const pairs: string[] = []
          for (const def of typeDefs) {
            const entry = runtimeVars[def.id]
            if (entry && entry.v != null && entry.v !== '') {
              pairs.push(`${def.displayName} = ${entry.v}`)
            }
          }
          if (pairs.length > 0) {
            lines.push(`${entity.name}: ${pairs.join(', ')}`)
          }
        }
        return lines.join('\n')
      }

      // Format entity name helper for story beats (uses title instead of name)
      const beatsWithName = storyBeats.map((b) => ({
        name: b.title,
        metadata: b.metadata,
      }))

      const runtimeVarsCharacters = formatEntities(characters, 'character')
      const runtimeVarsLocations = formatEntities(locations, 'location')
      const runtimeVarsItems = formatEntities(items, 'item')
      const runtimeVarsStoryBeats = formatEntities(beatsWithName, 'story_beat')

      // Protagonist-specific: filter to just the protagonist
      let runtimeVarsProtagonist = ''
      if (protagonist) {
        runtimeVarsProtagonist = formatEntities([protagonist], 'character')
      }

      this.add({
        runtimeVars_characters: runtimeVarsCharacters,
        runtimeVars_locations: runtimeVarsLocations,
        runtimeVars_items: runtimeVarsItems,
        runtimeVars_storyBeats: runtimeVarsStoryBeats,
        runtimeVars_protagonist: runtimeVarsProtagonist,
      })

      log('loadRuntimeVariableContext', {
        packId: this.packId,
        defCount: defs.length,
        hasCharVars: runtimeVarsCharacters.length > 0,
        hasLocVars: runtimeVarsLocations.length > 0,
        hasItemVars: runtimeVarsItems.length > 0,
        hasBeatVars: runtimeVarsStoryBeats.length > 0,
        hasProtagonistVars: runtimeVarsProtagonist.length > 0,
      })
    } catch (error) {
      log('loadRuntimeVariableContext failed', { packId: this.packId, error })
      this.add({
        runtimeVars_characters: '',
        runtimeVars_locations: '',
        runtimeVars_items: '',
        runtimeVars_storyBeats: '',
        runtimeVars_protagonist: '',
      })
    }
  }
}
