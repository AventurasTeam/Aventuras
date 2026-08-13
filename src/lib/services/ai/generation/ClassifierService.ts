import { generateStructured } from '../sdk/generate'
/**
 * Classifier Service
 *
 * Extracts world state from narrative responses (characters, locations, items, story beats).
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 *
 * NOTE: For classifier output types (CharacterUpdate, NewCharacter, etc.),
 * import directly from '$lib/services/ai/sdk/schemas/classifier'.
 *
 * Prompt generation flows through ContextBuilder + Liquid templates.
 */

import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  TimeTracker,
} from '$lib/types'
import type { ServiceId } from '$lib/stores/settings.svelte'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { database } from '$lib/services/database'
import { createLogger } from '$lib/log'
import { stripPicTags } from '$lib/utils/inlineImageParser'
import { stripNarratorMarkup } from '$lib/utils/text'
import { recentContent, AS_PROSE } from '$lib/utils/recentContent'
import {
  classificationResultSchema,
  clampNumber,
  type ClassificationResult,
} from '../sdk/schemas/classifier'
import {
  buildExtendedClassificationSchema,
  salvageClassification,
} from '../sdk/schemas/runtime-variables'
import type { RuntimeVariable, RuntimeEntityType } from '$lib/services/packs/types'
import { NoObjectGeneratedError } from 'ai'
import { jsonrepair } from 'jsonrepair'

const log = createLogger('Classifier')

/**
 * Context for classification.
 */
export interface ClassificationContext {
  storyId: string
  story: Story
  narrativeResponse: string
  userAction: string
  existingCharacters: Character[]
  existingLocations: Location[]
  existingItems: Item[]
  existingStoryBeats: StoryBeat[]
}

/**
 * Service that classifies narrative responses to extract world state changes.
 */
export class ClassifierService extends BaseAIService {
  private recentEntriesWindow: number

  constructor(serviceId: ServiceId, recentEntriesWindow: number = 7) {
    super(serviceId)
    this.recentEntriesWindow = recentEntriesWindow
  }

  /**
   * Classify a narrative response to extract world state changes.
   * When the story's pack defines runtime variables, the schema is dynamically
   * extended to include inline runtime variable extraction in the same LLM pass.
   */
  async classify(
    context: ClassificationContext,
    visibleEntries?: StoryEntry[],
    currentStoryTime?: TimeTracker | null,
  ): Promise<ClassificationResult> {
    log('classify', {
      narrativeLength: context.narrativeResponse.length,
      existingCharacters: context.existingCharacters.length,
      existingLocations: context.existingLocations.length,
      existingItems: context.existingItems.length,
      existingStoryBeats: context.existingStoryBeats.length,
    })

    const mode = context.story.mode ?? 'adventure'

    // Load runtime variable definitions for the story's pack (if any)
    let runtimeVars: RuntimeVariable[] = []
    let runtimeVarsByType: Record<string, RuntimeVariable[]> = {}
    const packId = await database.getStoryPackId(context.storyId)
    if (packId) {
      runtimeVars = await database.getRuntimeVariables(packId)
      runtimeVarsByType = this.groupByEntityType(runtimeVars)
    }

    // Build the schema: extended with inline vars if runtime variables exist, else base
    const schema =
      runtimeVars.length > 0
        ? buildExtendedClassificationSchema(runtimeVarsByType)
        : classificationResultSchema

    // Format existing entities for the prompt
    const existingCharacters = this.formatExistingCharacters(context.existingCharacters)
    const existingLocations = this.formatExistingLocations(context.existingLocations)
    const existingItems = this.formatExistingItems(context.existingItems)
    const existingBeats = this.formatExistingBeats(context.existingStoryBeats)

    // Build chat history block if entries provided
    const chatHistoryBlock = visibleEntries ? this.buildChatHistoryBlock(visibleEntries) : ''

    // Build time info
    const currentTimeInfo = currentStoryTime
      ? `Current story time: Year ${currentStoryTime.years}, Day ${currentStoryTime.days}, ${String(currentStoryTime.hours).padStart(2, '0')}:${String(currentStoryTime.minutes).padStart(2, '0')}`
      : ''

    // Build custom variable instructions for the prompt
    const customVariableInstructions =
      runtimeVars.length > 0 ? this.buildCustomVarInstructions(runtimeVarsByType) : ''

    // Create ContextBuilder from story -- auto-populates mode, pov, tense, genre, etc.
    const ctx = await ContextBuilder.forStory(context.storyId)

    // Add all runtime variables explicitly via ctx.add()
    ctx.add({
      genre: context.story.genre ? `Genre: ${context.story.genre}` : '',
      mode,
      currentTimeInfo,
      chatHistoryBlock,
      inputLabel: mode === 'creative-writing' ? 'Author Direction' : 'Player Action',
      userAction: cleanForClassification(context.userAction),
      narrativeResponse: cleanForClassification(context.narrativeResponse),
      existingCharacters,
      existingLocations,
      existingItems,
      existingBeats,
      hasStoryBeats: existingBeats !== '(none)',
      storyBeatTypes: 'milestone, quest, revelation, event, plot_point',
      itemLocationOptions: 'inventory, worn, ground, or specific location name',
      defaultItemLocation: 'inventory',
      sceneLocationDesc: 'Name of current location if identifiable, null otherwise',
      customVariableInstructions,
    })

    // Render through the classifier template
    const { system, user: prompt } = await ctx.render('classifier')

    try {
      const result = (await generateStructured(
        {
          presetId: this.presetId,
          schema,
          system,
          prompt,
        },
        'classifier',
      )) as ClassificationResult

      // Post-process: clamp number values to min/max constraints
      if (runtimeVars.length > 0) {
        this.clampRuntimeVarNumbers(result, runtimeVarsByType)
      }

      // Attach runtime variable definitions for use by applyClassificationResult
      if (runtimeVars.length > 0) {
        result._runtimeVarDefs = runtimeVars
      }

      log('classify complete', {
        characterUpdates: result.entryUpdates.characterUpdates.length,
        newCharacters: result.entryUpdates.newCharacters.length,
        locationUpdates: result.entryUpdates.locationUpdates.length,
        newLocations: result.entryUpdates.newLocations.length,
        itemUpdates: result.entryUpdates.itemUpdates.length,
        newItems: result.entryUpdates.newItems.length,
        storyBeatUpdates: result.entryUpdates.storyBeatUpdates.length,
        newStoryBeats: result.entryUpdates.newStoryBeats.length,
        timeProgression: result.scene.timeProgression,
        hasRuntimeVars: runtimeVars.length > 0,
      })

      return result
    } catch (error) {
      log('classify failed', error)
      return this.recover(error, runtimeVars, runtimeVarsByType)
    }
  }

  /**
   * Turn a failed classification into whatever of it is still usable.
   *
   * The response is one object holding eight arrays and the scene, and validation is
   * all-or-nothing: a single malformed entity used to cost the whole turn's world update
   * — every character, location, item, beat and the time progression with it — silently.
   * When the SDK rejected the object it kept the text that produced it, so the elements
   * that were fine are still there to be read back.
   */
  private recover(
    error: unknown,
    runtimeVars: RuntimeVariable[],
    runtimeVarsByType: Record<string, RuntimeVariable[]>,
  ): ClassificationResult {
    const empty: ClassificationResult = {
      entryUpdates: {
        characterUpdates: [],
        locationUpdates: [],
        itemUpdates: [],
        storyBeatUpdates: [],
        newCharacters: [],
        newLocations: [],
        newItems: [],
        newStoryBeats: [],
      },
      scene: {
        currentLocationName: null,
        presentCharacterNames: [],
        timeProgression: 'none',
      },
      _error: error instanceof Error ? error.message : String(error),
    }

    // Only a schema/parse rejection carries the model's text. A transport failure, an
    // abort or a 401 has nothing to salvage from.
    if (!NoObjectGeneratedError.isInstance(error) || !error.text) return empty

    // Repaired again here rather than trusting the text to be clean: `createJsonExtractMiddleware`
    // already extracts and repairs on the way through, but it swallows its own failure and hands
    // the original text on, so the one case that reaches this line is the one it could not fix.
    // A repair that succeeds where it failed costs a parse; the alternative is losing the turn.
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonrepair(error.text))
    } catch (parseError) {
      log('classify salvage: response is not recoverable JSON', parseError)
      return empty
    }

    const salvaged = salvageClassification(parsed, runtimeVarsByType)
    if (!salvaged) return empty

    if (runtimeVars.length > 0) {
      this.clampRuntimeVarNumbers(salvaged, runtimeVarsByType)
      salvaged._runtimeVarDefs = runtimeVars
    }
    salvaged._error = empty._error

    log('classify salvaged a partial result', {
      characterUpdates: salvaged.entryUpdates.characterUpdates.length,
      newCharacters: salvaged.entryUpdates.newCharacters.length,
      locationUpdates: salvaged.entryUpdates.locationUpdates.length,
      newLocations: salvaged.entryUpdates.newLocations.length,
      itemUpdates: salvaged.entryUpdates.itemUpdates.length,
      newItems: salvaged.entryUpdates.newItems.length,
      storyBeatUpdates: salvaged.entryUpdates.storyBeatUpdates.length,
      newStoryBeats: salvaged.entryUpdates.newStoryBeats.length,
      timeProgression: salvaged.scene.timeProgression,
    })

    return salvaged
  }

  /**
   * Group runtime variables by entity type.
   */
  private groupByEntityType(vars: RuntimeVariable[]): Record<string, RuntimeVariable[]> {
    return vars.reduce(
      (acc, v) => {
        if (!acc[v.entityType]) acc[v.entityType] = []
        acc[v.entityType].push(v)
        return acc
      },
      {} as Record<string, RuntimeVariable[]>,
    )
  }

  /**
   * Build the prompt instruction block describing custom variables to track.
   * Grouped by entity type for clarity.
   */
  private buildCustomVarInstructions(varsByType: Record<string, RuntimeVariable[]>): string {
    const ENTITY_TYPE_LABELS: Record<RuntimeEntityType, { updates: string; new: string }> = {
      character: { updates: 'character updates', new: 'new characters' },
      location: { updates: 'location updates', new: 'new locations' },
      item: { updates: 'item updates', new: 'new items' },
      story_beat: { updates: 'story beat updates', new: 'new story beats' },
    }

    const sections: string[] = []

    for (const [entityType, vars] of Object.entries(varsByType)) {
      if (vars.length === 0) continue
      const labels = ENTITY_TYPE_LABELS[entityType as RuntimeEntityType]
      if (!labels) continue

      const varLines = vars.map((v) => {
        let line = `- ${v.variableName}`
        const parts: string[] = []

        // Type description
        if (v.variableType === 'number') {
          let numDesc = 'number'
          if (v.minValue !== undefined && v.maxValue !== undefined) {
            numDesc = `number ${v.minValue}-${v.maxValue}`
          } else if (v.minValue !== undefined) {
            numDesc = `number >= ${v.minValue}`
          } else if (v.maxValue !== undefined) {
            numDesc = `number <= ${v.maxValue}`
          }
          parts.push(numDesc)
        } else if (v.variableType === 'enum' && v.enumOptions?.length) {
          parts.push(`enum: ${v.enumOptions.map((o) => o.value).join('|')}`)
        } else {
          parts.push('text')
        }

        // Nothing here is required by the schema (see buildEntityVarsShape); a variable
        // with no default is merely the one worth naming, since there is no sensible
        // value to fall back on when the model leaves it out.
        parts.push(
          v.defaultValue !== undefined && v.defaultValue !== null ? 'optional' : 'set if known',
        )

        // Default value
        if (v.defaultValue !== undefined && v.defaultValue !== null) {
          parts.push(`default: ${v.defaultValue}`)
        }

        line += ` (${parts.join(', ')})`
        if (v.description) line += `: ${v.description}`
        return line
      })

      sections.push(
        `For ${labels.updates}/${labels.new}, include these as direct fields alongside standard fields:\n${varLines.join('\n')}`,
      )
    }

    if (sections.length === 0) return ''

    return `## Custom Variables to Track\n${sections.join('\n\n')}`
  }

  /**
   * Post-process: clamp number-type runtime variable values to min/max constraints.
   * Walks through all entity updates/new entities and clamps inline number values.
   */
  private clampRuntimeVarNumbers(
    result: ClassificationResult,
    varsByType: Record<string, RuntimeVariable[]>,
  ): void {
    const numberDefs = new Map<string, RuntimeVariable>()
    for (const vars of Object.values(varsByType)) {
      for (const v of vars) {
        if (v.variableType === 'number' && (v.minValue !== undefined || v.maxValue !== undefined)) {
          numberDefs.set(v.variableName, v)
        }
      }
    }

    if (numberDefs.size === 0) return

    // Clamp inline number values on an object
    const clampInlineVars = (obj: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(obj)) {
        const def = numberDefs.get(key)
        if (def && typeof value === 'number') {
          obj[key] = clampNumber(value, def.minValue, def.maxValue)
        }
      }
    }

    // Walk all entity types — vars are inline on changes/entity objects
    for (const update of result.entryUpdates.characterUpdates) {
      clampInlineVars(update.changes as unknown as Record<string, unknown>)
    }
    for (const entity of result.entryUpdates.newCharacters) {
      clampInlineVars(entity as unknown as Record<string, unknown>)
    }
    for (const update of result.entryUpdates.locationUpdates) {
      clampInlineVars(update.changes as unknown as Record<string, unknown>)
    }
    for (const entity of result.entryUpdates.newLocations) {
      clampInlineVars(entity as unknown as Record<string, unknown>)
    }
    for (const update of result.entryUpdates.itemUpdates) {
      clampInlineVars(update.changes as unknown as Record<string, unknown>)
    }
    for (const entity of result.entryUpdates.newItems) {
      clampInlineVars(entity as unknown as Record<string, unknown>)
    }
    for (const update of result.entryUpdates.storyBeatUpdates) {
      clampInlineVars(update.changes as unknown as Record<string, unknown>)
    }
    for (const entity of result.entryUpdates.newStoryBeats) {
      clampInlineVars(entity as unknown as Record<string, unknown>)
    }
  }

  /**
   * Format existing characters for the prompt.
   *
   * **The name is the whole of its line.** The model reads this list and writes names back,
   * so a rendered suffix — `- Ada (claimed as a consort) [inactive]` — comes back as the
   * name and mints a second character. Attributes are indented `label: value` lines
   * instead, which a name containing parentheses cannot be confused with.
   *
   * `appearance` is sent only for characters in the scene. It is there to be rewritten, and
   * only someone present can have their look updated; on a large cast it is also most of
   * the prompt. The template forbids rewriting an appearance that is not shown, so a
   * returning character keeps the descriptors it accumulated.
   */
  private formatExistingCharacters(characters: Character[]): string {
    if (characters.length === 0) return '(none)'

    return characters
      .map((c) => {
        const status = c.status ?? 'active'
        let entry = `- ${c.name}`
        if (c.relationship) entry += `\n  relationship: ${c.relationship}`
        // `active` is printed too, or the list is asymmetric: the model would be reminded to
        // report a return and never a departure.
        entry += `\n  status: ${status}`
        if (
          status === 'active' &&
          c.visualDescriptors &&
          Object.keys(c.visualDescriptors).length > 0
        ) {
          entry += `\n  appearance: ${this.formatVisualDescriptors(c.visualDescriptors)}`
        }
        return entry
      })
      .join('\n')
  }

  /**
   * Format visual descriptors object into a readable string.
   */
  private formatVisualDescriptors(descriptors: Character['visualDescriptors']): string {
    if (!descriptors) return ''

    const parts: string[] = []
    if (descriptors.face) parts.push(`Face: ${descriptors.face}`)
    if (descriptors.hair) parts.push(`Hair: ${descriptors.hair}`)
    if (descriptors.eyes) parts.push(`Eyes: ${descriptors.eyes}`)
    if (descriptors.build) parts.push(`Build: ${descriptors.build}`)
    if (descriptors.clothing) parts.push(`Clothing: ${descriptors.clothing}`)
    if (descriptors.accessories) parts.push(`Accessories: ${descriptors.accessories}`)
    if (descriptors.distinguishing) parts.push(`Distinguishing: ${descriptors.distinguishing}`)

    return parts.join(', ')
  }

  /**
   * Format existing locations for the prompt.
   *
   * One name per line, as with characters: a comma-separated list cannot hold a name that
   * contains a comma, and this list is copied back verbatim.
   *
   * Only the current location carries its description. A passage can re-describe the place
   * it happens in and no other, and `description` is a whole-value replacement — the model
   * must not rewrite one it was never shown.
   */
  private formatExistingLocations(locations: Location[]): string {
    if (locations.length === 0) return '(none)'

    return locations
      .map((l) => {
        let entry = `- ${l.name}`
        if (l.current) {
          entry += `\n  current: true`
          if (l.description) entry += `\n  description: ${l.description}`
        }
        return entry
      })
      .join('\n')
  }

  /**
   * Format existing items for the prompt.
   *
   * State is printed only where it differs from the default, so the list stays short: an
   * unequipped single item sitting in the inventory is just its name.
   */
  private formatExistingItems(items: Item[]): string {
    if (items.length === 0) return '(none)'

    return items
      .map((i) => {
        let entry = `- ${i.name}`
        if (i.quantity > 1) entry += `\n  quantity: ${i.quantity}`
        if (i.equipped) entry += `\n  equipped: true`
        if (i.location && i.location !== 'inventory') entry += `\n  location: ${i.location}`
        return entry
      })
      .join('\n')
  }

  /**
   * Format existing story beats for the prompt.
   */
  private formatExistingBeats(beats: StoryBeat[]): string {
    const activeBeats = beats.filter((b) => b.status === 'active' || b.status === 'pending')
    if (activeBeats.length === 0) return '(none)'

    return (
      activeBeats
        // Same rule as the character list: the title is the whole of its line. It is quoted
        // as well, but a suffix is what the model copies back, so nothing follows it.
        .map((b) => {
          let entry = `- "${b.title}"`
          entry += `\n  status: ${b.status}`
          if (b.description) entry += `\n  description: ${b.description}`
          return entry
        })
        .join('\n')
    )
  }

  /**
   * Recent turns, whole. The window is short because these entries carry the scene the
   * classifier reports on -- who is present, what changed -- and that lives at the end of
   * a narration, which any per-entry truncation cuts off first.
   */
  private buildChatHistoryBlock(entries: StoryEntry[]): string {
    if (entries.length === 0) return ''

    const formatted = recentContent(entries, this.recentEntriesWindow, AS_PROSE, {
      roles: true,
      time: true,
      transform: cleanForClassification,
    })

    return `## Recent Chat History\n${formatted}\n`
  }
}

/** Neither the image markup nor the narrator's layout is part of the passage to classify. */
function cleanForClassification(content: string): string {
  return stripNarratorMarkup(stripPicTags(content))
}
