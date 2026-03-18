/**
 * Action Choices Service
 *
 * Generates action choices for adventure mode gameplay.
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 *
 * Prompt generation flows through ContextBuilder + Liquid templates.
 */

import type { StoryEntry, Character, Location, Item, StoryBeat } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { getLorebookConfig } from '../core/config'
import { storyContext } from '$lib/stores/storyContext.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { createLogger } from '$lib/log'
import { actionChoicesResultSchema, type ActionChoice } from '../sdk/schemas/actionchoices'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'
import { prepareLorebookForContext } from '$lib/services/context/lorebookMapper'
import { mapStoryEntriesToContext } from '$lib/services/context/storyEntryMapper'
import type { StyleReviewResult } from './StyleReviewerService'

const log = createLogger('ActionChoices')

export interface ActionChoicesContext {
  storyId?: string
  narrativeResponse: string
  userAction: string
  recentEntries: StoryEntry[]
  protagonistName: string
  protagonistDescription?: string | null
  mode: string
  pov: string
  tense: string
  currentLocation?: Location | null
  presentCharacters?: Character[]
  inventory?: Item[]
  activeQuests?: StoryBeat[]
  lorebookEntries?: ContextLorebookEntry[]
  styleReview?: StyleReviewResult | null
}

/**
 * Service that generates action choices for adventure mode.
 */
export class ActionChoicesService extends BaseAIService {
  constructor(serviceId: string) {
    super(serviceId)
  }

  /**
   * Zero-arg overload: reads all context from storyContext singleton.
   * Used by the generation pipeline.
   */
  async generateChoices(): Promise<ActionChoice[]>
  /**
   * Parameterized overload: explicit context for non-pipeline callers.
   */
  async generateChoices(context: ActionChoicesContext): Promise<ActionChoice[]>
  async generateChoices(context?: ActionChoicesContext): Promise<ActionChoice[]> {
    if (context === undefined) {
      // Zero-arg: build context from singleton
      const story = storyContext.currentStory
      const entries = storyContext.visibleEntries
      const lastUserAction = [...entries].filter((e) => e.type === 'user_action').pop()
      const protagonist = storyContext.protagonist
      const presentCharacters = storyContext.characters.filter(
        (c) => c.relationship !== 'self' && c.status === 'active',
      )
      const inventory = storyContext.items.filter((i) => i.equipped)
      const activeQuests = storyContext.pendingQuests
      const lorebookEntries = storyContext.retrievalResult?.lorebookEntries ?? []

      const ctx: ActionChoicesContext = {
        storyId: story?.id,
        narrativeResponse: storyContext.narrativeResult?.content ?? '',
        userAction: lastUserAction?.content ?? '',
        recentEntries: entries.slice(-10),
        protagonistName: protagonist?.name ?? 'the protagonist',
        protagonistDescription: protagonist?.description,
        mode: storyContext.storyMode,
        pov: storyContext.pov,
        tense: storyContext.tense,
        currentLocation: storyContext.currentLocation,
        presentCharacters,
        inventory,
        activeQuests,
        lorebookEntries,
        styleReview: ui.lastStyleReview,
      }
      return this._generateChoicesInternal(ctx)
    }
    return this._generateChoicesInternal(context)
  }

  /**
   * Generate action choices based on current narrative context.
   */
  private async _generateChoicesInternal(context: ActionChoicesContext): Promise<ActionChoice[]> {
    log('generateChoices called', {
      narrativeLength: context.narrativeResponse.length,
      recentEntriesCount: context.recentEntries.length,
      protagonist: context.protagonistName,
      hasStoryId: !!context.storyId,
    })

    // Map recent entries via structured mapper
    const storyEntries = mapStoryEntriesToContext(context.recentEntries, {
      stripPicTags: true,
      maxEntries: 5,
    })

    // Format current location
    const currentLocation = context.currentLocation?.name ?? 'Unknown'

    // Format NPCs present (exclude self)
    const npcsPresent =
      context.presentCharacters
        ?.filter((c) => c.relationship !== 'self')
        .map((c) => c.name)
        .join(', ') || 'None'

    // Format inventory
    const inventory = context.inventory?.map((i) => i.name).join(', ') || 'None'

    // Format active quests (pending or active, not completed or failed)
    const activeQuests =
      context.activeQuests
        ?.filter((q) => q.status === 'pending' || q.status === 'active')
        .map((q) => `• ${q.title}${q.description ? `: ${q.description}` : ''}`)
        .join('\n') || 'None'

    // Prepare lorebook entries using structured mapper
    const lorebookConfig = getLorebookConfig()
    const preparedLorebook = prepareLorebookForContext(
      context.lorebookEntries ?? [],
      lorebookConfig.maxForActionChoices,
    )

    // Protagonist description
    const protagonistDescription = context.protagonistDescription
      ? ` (${context.protagonistDescription})`
      : ''

    // POV instruction
    const povInstruction =
      context.pov === 'first'
        ? 'Use first person (I, me, my) for all action choices.'
        : context.pov === 'second'
          ? 'Use second person (you, your) for all action choices.'
          : 'Use third person for all action choices.'

    // Length instruction
    const lengthInstruction = 'Keep each choice concise but specific - typically 5-15 words.'

    // Create ContextBuilder -- use forStory when storyId available
    let ctx: ContextBuilder
    if (context.storyId) {
      ctx = await ContextBuilder.forStory(context.storyId)
    } else {
      ctx = new ContextBuilder()
      ctx.add({
        mode: context.mode,
        pov: context.pov,
        tense: context.tense,
        protagonistName: context.protagonistName,
      })
    }

    // Add runtime variables for template rendering
    ctx.add({
      narrativeResponse: context.narrativeResponse,
      storyEntries,
      currentLocation,
      npcsPresent,
      inventory,
      activeQuests,
      protagonistDescription,
      povInstruction,
      lengthInstruction,
    })
    if (preparedLorebook.length > 0) {
      ctx.add({ lorebookEntries: preparedLorebook })
    }
    if (context.styleReview && context.styleReview.phrases.length > 0) {
      ctx.add({ styleReview: context.styleReview })
    }

    // Render through the action-choices template
    const { system, user: prompt } = await ctx.render('action-choices')

    try {
      const result = await this.generate(
        actionChoicesResultSchema,
        system,
        prompt,
        'action-choices',
      )

      log('Action choices generated:', result.choices.length)
      return result.choices.slice(0, 4)
    } catch (error) {
      log('Action choices generation failed:', error)
      return []
    }
  }
}
