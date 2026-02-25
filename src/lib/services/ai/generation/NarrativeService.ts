/**
 * Narrative Service
 *
 * The core service that generates story responses.
 * This is the heart of the application - it handles narrative generation
 * both streaming and non-streaming.
 *
 * Unlike other services that use the preset system, NarrativeService uses
 * the main narrative profile directly (apiSettings.defaultModel, temperature, maxTokens).
 *
 * Uses ContextBuilder for prompt generation through the unified Liquid template pipeline.
 */

import { streamNarrative, generateNarrative } from '../sdk/generate'
import { ContextBuilder } from '$lib/services/context'
import { StyleReviewerService } from './StyleReviewerService'
import { createLogger } from '../core/config'
import type { StreamChunk } from '../core/types'
import type {
  Story,
  StoryEntry,
  Entry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  TimeTracker,
} from '$lib/types'
import type { StyleReviewResult } from './StyleReviewerService'
import type { TimelineFillResult } from '../retrieval/TimelineFillService'

const log = createLogger('Narrative')

/**
 * Full instruction text for inline image generation via <pic> tags.
 * Injected into ContextBuilder when inlineImageMode is enabled on a story.
 * Templates reference this via {{ inlineImageInstructions }}.
 */
const INLINE_IMAGE_INSTRUCTIONS = `<InlineImages>
You can embed images directly in your narrative using the <pic> tag. Images will be generated automatically where you place these tags.

**TAG FORMAT:**
<pic prompt="[detailed visual description]" characters="[character names]"></pic>

**ATTRIBUTES:**
- \`prompt\` (REQUIRED): A detailed visual description for image generation. Write as a complete scene description, NOT a reference to the text. **MUST ALWAYS BE IN ENGLISH** regardless of the narrative language.
- \`characters\` (optional): Comma-separated names of characters appearing in the image (for portrait reference).

**USAGE GUIDELINES:**
- Place <pic> tags AFTER the prose that describes the scene they illustrate
- Write prompts as detailed visual descriptions: subject, action, setting, mood, lighting, art style
- Include character names in the "characters" attribute if they appear in the image
- Use sparingly: 1-3 images per response maximum, reserved for impactful visual moments
- Best used for: dramatic reveals, emotional peaks, action climaxes, new locations, important character moments

**EXAMPLE:**
The dragon descended from the storm clouds, its obsidian scales gleaming with each flash of lightning.
<pic prompt="A massive black dragon descending from dark storm clouds, scales gleaming with rain, lightning illuminating the scene, dramatic low angle shot, dark fantasy art style" characters=""></pic>

Elena drew her blade, firelight dancing along the steel edge as she faced the creature.
<pic prompt="Young woman warrior with determined expression drawing a glowing sword, firelight reflecting on blade and face, medieval interior background, dramatic lighting, fantasy art" characters="Elena"></pic>

**CRITICAL RULES:**
- **PROMPTS MUST BE IN ENGLISH** - Image generation models only understand English prompts. Always write the prompt attribute in English, even if the surrounding narrative is in another language.
- The prompt must be a COMPLETE visual description - do not write "the dragon from the scene" or "as described above"
- Never place <pic> tags in the middle of a sentence - always after the descriptive prose
- Do not use <pic> for every scene - reserve for truly striking visual moments
- Keep prompts between 50-150 words for best results
</InlineImages>`

/**
 * Full instruction text for visual prose mode (HTML/CSS formatting).
 * Injected into ContextBuilder when visualProseMode is enabled on a story.
 * Templates reference this via {{ visualProseInstructions }}.
 */
const VISUAL_PROSE_INSTRUCTIONS = `<VisualProse>
You are also a visual artist with HTML5 and CSS3 at your disposal. Your entire response must be valid HTML.

**OUTPUT FORMAT (CRITICAL):**
Your response must be FULLY STRUCTURED HTML:
- Wrap ALL prose paragraphs in \`<p>\` tags
- Use \`<span>\` with inline styles for colored/styled text (dialogue, emphasis, actions)
- Use \`<div>\` with \`<style>\` blocks for complex visual elements (menus, letters, signs, etc.)
- NO plain text outside of HTML tags - everything must be wrapped

Example structure:
\`\`\`html
<p>She stepped into the tavern, the smell of smoke and ale washing over her.</p>

<p><span style="color: #8B4513;">"Welcome, stranger,"</span> the bartender said, sliding a mug across the counter.</p>

<style>
.tavern-sign { background: #2a1810; padding: 15px; border: 3px solid #8B4513; }
.tavern-sign h2 { color: #d4a574; text-align: center; }
</style>
<div class="tavern-sign">
  <h2>The Rusty Anchor</h2>
  <p>Est. 1847</p>
</div>

<p>She studied the sign, then turned back to her drink.</p>
\`\`\`

**STYLING CAPABILITIES:**
- **Layouts:** CSS Grid, Flexbox, block/inline positioning
- **Styling:** Backgrounds, gradients, typography, borders, colors - themed by scene and genre
- **Interactivity:** :hover, :focus, :active states for subtle effects
- **Animation:** @keyframes for movement, rotation, fading, opacity changes
- **Variables:** CSS Custom Properties (--variable) for theming

**FORBIDDEN:**
- Plain text without HTML tags (NO raw paragraphs - use \`<p>\`)
- Markdown syntax (\`*asterisks*\`, \`**bold**\`) - use \`<em>\`, \`<strong>\`, or \`<span>\` with styles instead
- \`position: fixed/absolute\` - breaks the interface
- \`<script>\` tags - only HTML and CSS
- Box-shadow animation - use border-color, background-color, or opacity instead

**PRINCIPLES:**
- Purpose over flash - every visual choice serves the narrative
- Readability is paramount - never sacrifice text clarity for effects
- Seamless integration - visuals feel like part of the story

Create atmospheric layouts, styled dialogue, themed visual elements. Match visual style to genre and mood.
</VisualProse>`

/**
 * World state context for prompt building
 */
export interface WorldStateContext {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  currentLocation?: Location
  chapters?: Chapter[]
}

/**
 * World state context for narrative generation.
 * Extends the base WorldStateContext with lorebook entries.
 */
export interface NarrativeWorldState extends WorldStateContext {
  lorebookEntries?: Entry[]
}

/**
 * Format a TimeTracker into a human-readable string for the narrative prompt.
 * Always returns a value, defaulting to Year 1, Day 1, 0 hours 0 minutes if null.
 */
export function formatStoryTime(time: TimeTracker | null | undefined): string {
  const t = time ?? { years: 0, days: 0, hours: 0, minutes: 0 }
  const year = t.years + 1
  const day = t.days + 1
  return `Year ${year}, Day ${day}, ${t.hours} hours ${t.minutes} minutes`
}

/**
 * Build a block containing chapter summaries for injection into the system prompt.
 * Per design doc: summarized entries are excluded from direct context,
 * but their summaries provide narrative continuity.
 */
export function buildChapterSummariesBlock(
  chapters: Chapter[],
  timelineFillResult?: TimelineFillResult | null,
): string {
  if (chapters.length === 0) return ''

  let block = '\n\n<story_history>\n'
  block += '## Previous Chapters\n'
  block +=
    'The following chapters have occurred earlier in the story. Use them for continuity and context.\n\n'

  for (const chapter of chapters) {
    block += `### Chapter ${chapter.number}`
    if (chapter.title) {
      block += `: ${chapter.title}`
    }
    block += '\n'

    const startTime = formatStoryTime(chapter.startTime)
    const endTime = formatStoryTime(chapter.endTime)
    if (startTime && endTime) {
      block += `*Time: ${startTime} \u2192 ${endTime}*\n`
    } else if (startTime) {
      block += `*Time: ${startTime}*\n`
    }

    block += chapter.summary
    block += '\n'

    const metadata: string[] = []
    if (chapter.characters.length > 0) {
      metadata.push(`Characters: ${chapter.characters.join(', ')}`)
    }
    if (chapter.locations.length > 0) {
      metadata.push(`Locations: ${chapter.locations.join(', ')}`)
    }
    if (chapter.emotionalTone) {
      metadata.push(`Tone: ${chapter.emotionalTone}`)
    }
    if (metadata.length > 0) {
      block += `*${metadata.join(' | ')}*\n`
    }
    block += '\n'
  }

  if (timelineFillResult && timelineFillResult.responses.length > 0) {
    block += '## Retrieved Context\n'
    block +=
      'The following information was retrieved from past chapters and is relevant to the current scene:\n\n'

    for (const response of timelineFillResult.responses) {
      const chapterLabel =
        response.chapterNumbers.length === 1
          ? `Chapter ${response.chapterNumbers[0]}`
          : `Chapters ${response.chapterNumbers.join(', ')}`

      block += `**${chapterLabel}**\n`
      block += `Q: ${response.query}\n`
      block += `A: ${response.answer}\n\n`
    }
  }

  block += '</story_history>'
  return block
}

/**
 * Options for narrative generation.
 */
export interface NarrativeOptions {
  /** Pre-built tiered context block for injection */
  tieredContextBlock?: string
  /** Style review results for avoiding repetition */
  styleReview?: StyleReviewResult | null
  /** Retrieved chapter context from memory system */
  retrievedChapterContext?: string | null
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Timeline fill result for Q&A injection */
  timelineFillResult?: TimelineFillResult | null
}

/**
 * Service for generating narrative responses.
 *
 * This service uses the main narrative profile from apiSettings directly,
 * rather than going through the preset system. This ensures narrative
 * generation uses the user's primary model and settings.
 *
 * Prompt generation flows through ContextBuilder + Liquid templates.
 */
export class NarrativeService {
  /**
   * Create a new NarrativeService.
   * No preset required - uses main narrative profile from settings.
   */
  constructor() {
    // No configuration needed - uses main profile directly
  }

  /**
   * Stream a narrative response.
   *
   * This is the primary method used by the UI for real-time narrative generation.
   * Yields StreamChunk objects as text arrives from the model.
   */
  async *stream(
    entries: StoryEntry[],
    worldState: NarrativeWorldState,
    story?: Story | null,
    options: NarrativeOptions = {},
  ): AsyncIterable<StreamChunk> {
    const { tieredContextBlock, styleReview, retrievedChapterContext, signal, timelineFillResult } =
      options

    log('stream', {
      entriesCount: entries.length,
      hasTieredContext: !!tieredContextBlock,
      hasStyleReview: !!styleReview,
      hasRetrievedContext: !!retrievedChapterContext,
      hasTimelineFill: !!timelineFillResult,
    })

    // Build system prompt via ContextBuilder pipeline
    const { systemPrompt, primingMessage } = await this.buildPrompts(
      story,
      worldState,
      tieredContextBlock,
      styleReview,
      retrievedChapterContext,
      timelineFillResult,
    )

    // Build the user prompt from entries
    const mode = story?.mode ?? 'adventure'
    const userPrompt = this.buildUserPrompt(entries, mode)

    try {
      // Stream using the main narrative profile
      const stream = streamNarrative({
        system: systemPrompt,
        prompt: `${primingMessage}\n\n${userPrompt}`,
        signal,
      })

      // Use fullStream to capture both text and reasoning
      // - Native reasoning providers (Anthropic, OpenAI) emit reasoning-delta parts
      // - Models using <think> tags have reasoning extracted by extractReasoningMiddleware
      for await (const part of stream.fullStream) {
        if (part.type === 'reasoning-delta') {
          // Reasoning delta from native providers or extracted from <think> tags
          yield { content: '', reasoning: (part as { text?: string }).text, done: false }
        } else if (part.type === 'text-delta') {
          // Regular text content
          yield { content: (part as { text?: string }).text || '', done: false }
        }
        // Ignore other part types (reasoning-start, reasoning-end, tool calls, finish, etc.)
      }

      yield { content: '', done: true }
    } catch (error) {
      log('stream error', error)
      // Re-throw to let caller handle the error
      throw error
    }
  }

  /**
   * Generate a complete narrative response (non-streaming).
   *
   * Used for scenarios where streaming is not needed or supported.
   */
  async generate(
    entries: StoryEntry[],
    worldState: NarrativeWorldState,
    story?: Story | null,
    options: Omit<NarrativeOptions, 'timelineFillResult'> = {},
  ): Promise<string> {
    const { tieredContextBlock, styleReview, retrievedChapterContext, signal } = options

    log('generate', { entriesCount: entries.length })

    // Build system prompt via ContextBuilder pipeline
    const { systemPrompt, primingMessage } = await this.buildPrompts(
      story,
      worldState,
      tieredContextBlock,
      styleReview,
      retrievedChapterContext,
    )

    const mode = story?.mode ?? 'adventure'
    const userPrompt = this.buildUserPrompt(entries, mode)

    return generateNarrative({
      system: systemPrompt,
      prompt: `${primingMessage}\n\n${userPrompt}`,
      signal,
    })
  }

  /**
   * Build system and priming prompts through the ContextBuilder pipeline.
   *
   * Creates a ContextBuilder from the story, adds runtime variables
   * (tiered context, chapter summaries, style guidance), then renders
   * through the Liquid template for the story's mode.
   */
  private async buildPrompts(
    story: Story | null | undefined,
    worldState: NarrativeWorldState,
    tieredContextBlock?: string,
    styleReview?: StyleReviewResult | null,
    retrievedChapterContext?: string | null,
    timelineFillResult?: TimelineFillResult | null,
  ): Promise<{ systemPrompt: string; primingMessage: string }> {
    const mode = story?.mode ?? 'adventure'

    // Create ContextBuilder -- forStory auto-populates mode, pov, tense, genre,
    // protagonistName, protagonistDescription, currentLocation, storyTime, etc.
    let ctx: ContextBuilder

    if (story?.id) {
      ctx = await ContextBuilder.forStory(story.id)
    } else {
      // Fallback for edge cases where story doesn't exist yet
      ctx = new ContextBuilder()
      ctx.add({
        mode,
        pov: story?.settings?.pov ?? 'second',
        tense: story?.settings?.tense ?? 'present',
        protagonistName: 'the protagonist',
      })
    }

    // Add runtime variables for template rendering
    // These are pre-formatted blocks that templates inject via {{ variable }}

    if (tieredContextBlock) {
      ctx.add({ tieredContextBlock })
    }

    if (retrievedChapterContext) {
      ctx.add({ retrievedChapterContext })
    }

    // Build chapter summaries block
    if (worldState.chapters && worldState.chapters.length > 0) {
      const chapterSummaries = buildChapterSummariesBlock(worldState.chapters, timelineFillResult)
      if (chapterSummaries) {
        ctx.add({ chapterSummaries })
      }
    }

    // Build style guidance block
    if (styleReview && styleReview.phrases.length > 0) {
      const styleGuidance = StyleReviewerService.formatForPromptInjection(styleReview)
      if (styleGuidance) {
        ctx.add({ styleGuidance })
      }
    }

    // Inject feature instruction content when modes are enabled
    // These provide the actual instructions (not just boolean flags) that templates reference
    // via {{ inlineImageInstructions }} and {{ visualProseInstructions }}
    const preRenderContext = ctx.getContext()
    if (preRenderContext.inlineImageMode) {
      ctx.add({ inlineImageInstructions: INLINE_IMAGE_INSTRUCTIONS })
    }
    if (preRenderContext.visualProseMode) {
      ctx.add({ visualProseInstructions: VISUAL_PROSE_INSTRUCTIONS })
    }

    // Render through the mode-specific template
    const templateId = mode === 'creative-writing' ? 'creative-writing' : 'adventure'
    const { system: systemPrompt } = await ctx.render(templateId)

    // Build priming message based on mode/pov/tense
    const context = ctx.getContext()
    const primingMessage = this.buildPrimingMessage(
      mode,
      (context.pov as string) ?? 'second',
      (context.tense as string) ?? 'present',
      (context.protagonistName as string) ?? 'the protagonist',
    )

    log('buildPrompts complete', {
      mode,
      templateId,
      systemPromptLength: systemPrompt.length,
      primingMessageLength: primingMessage.length,
    })

    return { systemPrompt, primingMessage }
  }

  /**
   * Build the user prompt from recent story entries.
   *
   * Formats entries as a conversation history with the current action highlighted.
   */
  private buildUserPrompt(entries: StoryEntry[], mode: 'adventure' | 'creative-writing'): string {
    // Use all entries passed - these are already the visible (non-summarized) entries
    // Truncation/context management happens upstream via the memory system

    // Format entries based on mode
    const historyParts: string[] = []
    for (const entry of entries) {
      if (entry.type === 'user_action') {
        const prefix = mode === 'creative-writing' ? '[DIRECTION]' : '[ACTION]'
        historyParts.push(`${prefix} ${entry.content}`)
      } else if (entry.type === 'narration') {
        historyParts.push(`[NARRATIVE]\n${entry.content}`)
      }
    }

    // Get the last user action as the current input
    const lastUserAction = [...entries].reverse().find((e) => e.type === 'user_action')
    const currentAction = lastUserAction?.content ?? ''

    // Build final prompt
    let prompt = ''

    if (historyParts.length > 1) {
      // Include history minus the last action (which becomes current)
      prompt += '## Recent Story:\n'
      prompt += historyParts.slice(0, -1).join('\n\n')
      prompt += '\n\n'
    }

    prompt += '## Current Action:\n'
    prompt += currentAction
    prompt += '\n\n'
    prompt += 'Continue the narrative:'

    return prompt
  }

  /**
   * Build a priming user message to establish the narrator role.
   * This helps models that expect user-first conversation format.
   */
  private buildPrimingMessage(
    mode: string,
    pov: string,
    tense: string,
    protagonistName: string,
  ): string {
    if (mode === 'creative-writing') {
      return this.buildCreativeWritingPriming(pov, tense, protagonistName)
    }
    return this.buildAdventurePriming(pov, tense, protagonistName)
  }

  private buildAdventurePriming(pov: string, tense: string, protagonistName: string): string {
    const tenseWord = tense === 'past' ? 'past' : 'present'
    const actionExample =
      tense === 'past' ? 'pushed open the heavy door' : 'pushes open the heavy door'
    const descWords =
      tense === 'past'
        ? 'saw, heard, and experienced as I explored'
        : 'see, hear, and experience as I explore'

    if (pov === 'third') {
      return `You are the narrator of this interactive adventure. Write in ${tenseWord} tense, third person (they/the character name).

Your role:
- Describe ${protagonistName}'s experiences and the world around them
- Control all NPCs and the environment
- NEVER write ${protagonistName}'s dialogue, decisions, or inner thoughts - I decide those
- When I say "I do X", describe the results in third person (e.g., "I open the door" -> "${protagonistName} ${actionExample}...")

I am the player controlling ${protagonistName}. You narrate what happens. Begin when I take my first action.`
    }

    return `You are the narrator of this interactive adventure. Write in ${tenseWord} tense, second person (you/your).

Your role:
- Describe what I ${descWords}
- Control all NPCs and the environment
- NEVER write my dialogue, decisions, or inner thoughts
- When I say "I do X", describe the results using "you" (e.g., "I open the door" -> "You ${actionExample}...")

I am the player. You narrate the world around me. Begin when I take my first action.`
  }

  private buildCreativeWritingPriming(pov: string, tense: string, protagonistName: string): string {
    const tenseWord = tense === 'past' ? 'past' : 'present'

    if (pov === 'first') {
      return `You are a skilled fiction writer. Write in ${tenseWord} tense, first person (I/me/my).

Your role:
- Write prose based on my directions from ${protagonistName}'s internal perspective
- Bring scenes to life with vivid detail and internal monologue
- Write for any character I direct you to, including dialogue, actions, and thoughts
- Maintain consistent characterization throughout

I am the author directing the story. Write what I ask for.`
    }

    if (pov === 'second') {
      return `You are a skilled fiction writer. Write in ${tenseWord} tense, second person (you/your).

Your role:
- Write prose based on my directions, addressing ${protagonistName} directly
- Bring scenes to life with vivid detail
- Write for any character I direct you to, including dialogue, actions, and thoughts
- Maintain consistent characterization throughout

I am the author directing the story. Write what I ask for.`
    }

    // Third person (default for creative-writing)
    return `You are a skilled fiction writer. Write in ${tenseWord} tense, third person (they/the character name).

Your role:
- Write prose based on my directions
- Bring scenes to life with vivid detail
- Write for any character I direct you to, including dialogue, actions, and thoughts
- Maintain consistent characterization throughout

I am the author directing the story. Write what I ask for.`
  }
}
