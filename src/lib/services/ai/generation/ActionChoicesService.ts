/**
 * Action Choices Service
 *
 * Generates action choices for adventure mode gameplay.
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 *
 * Prompt generation flows through ContextBuilder + Liquid templates.
 */

import type { StoryEntry, Entry, Character, Location, Item, StoryBeat } from '$lib/types'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '../core/config'
import { generateStructured } from '../sdk/generate'
import { actionChoicesResultSchema, type ActionChoice } from '../sdk/schemas/actionchoices'

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
  lorebookEntries?: Entry[]
}

/**
 * Service that generates action choices for adventure mode.
 */
export class ActionChoicesService {
  private presetId: string

  constructor(presetId: string = 'actionChoices') {
    this.presetId = presetId
  }

  /**
   * Generate action choices based on current narrative context.
   */
  async generateChoices(context: ActionChoicesContext): Promise<ActionChoice[]> {
    log('generateChoices called', {
      narrativeLength: context.narrativeResponse.length,
      recentEntriesCount: context.recentEntries.length,
      protagonist: context.protagonistName,
      hasStoryId: !!context.storyId,
    })

    // Format recent context
    const recentContext = context.recentEntries
      .slice(-5)
      .map((e) => `[${e.type === 'user_action' ? 'ACTION' : 'NARRATIVE'}]: ${e.content}`)
      .join('\n\n')

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

    // Format lorebook context
    let lorebookContext = ''
    if (context.lorebookEntries && context.lorebookEntries.length > 0) {
      const entryDescriptions = context.lorebookEntries
        .slice(0, 10)
        .map((e) => {
          let desc = `• ${e.name} (${e.type})`
          if (e.description) {
            desc += `: ${e.description.substring(0, 100)}${e.description.length > 100 ? '...' : ''}`
          }
          return desc
        })
        .join('\n')
      lorebookContext = `\n## World Context\n${entryDescriptions}\n`
    }

    // Protagonist description
    const protagonistDescription = context.protagonistDescription
      ? ` (${context.protagonistDescription})`
      : ''

    // Style guidance based on recent user actions
    const userActions = context.recentEntries.filter((e) => e.type === 'user_action').slice(-3)
    let styleGuidance = ''
    if (userActions.length > 0) {
      const avgLength =
        userActions.reduce((sum, e) => sum + e.content.length, 0) / userActions.length
      if (avgLength < 30) {
        styleGuidance =
          "\n## Style: Match the player's TERSE style - keep choices short and punchy (under 10 words each).\n"
      } else if (avgLength > 100) {
        styleGuidance =
          "\n## Style: Match the player's DETAILED style - include specific details in each choice.\n"
      }
    }

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
      recentContext,
      currentLocation,
      npcsPresent,
      inventory,
      activeQuests,
      lorebookContext,
      protagonistDescription,
      styleGuidance,
      povInstruction,
      lengthInstruction,
    })

    // Render through the action-choices template
    const { system, user: prompt } = await ctx.render('action-choices')

    try {
      const result = await generateStructured(
        {
          presetId: this.presetId,
          schema: actionChoicesResultSchema,
          system,
          prompt,
        },
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
