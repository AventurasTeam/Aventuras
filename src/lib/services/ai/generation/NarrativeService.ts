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
import { mapChaptersToContext } from '$lib/services/context/chapterMapper'
import { mapStoryEntriesToContext } from '$lib/services/context/storyEntryMapper'
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
} from '$lib/types'
import type { StyleReviewResult } from './StyleReviewerService'
import type { TimelineFillResult } from '../retrieval/TimelineFillService'
import type { WorldStateArrays } from '$lib/services/context/worldStateMapper'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'

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
 * Options for narrative generation.
 */
export interface NarrativeOptions {
  /** World state arrays from the tiered context mapper */
  worldStateArrays?: WorldStateArrays
  /** Style review results for avoiding repetition */
  styleReview?: StyleReviewResult | null
  /** Agentic retrieval context from memory system (replaces retrievedChapterContext) */
  agenticRetrievalContext?: string | null
  /** Lorebook entries for structured lorebook injection */
  lorebookEntries?: ContextLorebookEntry[]
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
    const {
      worldStateArrays,
      styleReview,
      agenticRetrievalContext,
      lorebookEntries,
      signal,
      timelineFillResult,
    } = options

    log('stream', {
      entriesCount: entries.length,
      hasTieredContext: !!worldStateArrays,
      hasStyleReview: !!styleReview,
      hasAgenticContext: !!agenticRetrievalContext,
      hasTimelineFill: !!timelineFillResult,
      lorebookEntriesCount: lorebookEntries?.length ?? 0,
    })

    const inlineImageMode = story?.settings?.imageGenerationMode === 'inline'

    // Build system prompt and user message via ContextBuilder pipeline
    const { systemPrompt, userMessage } = await this.buildPrompts(
      entries,
      inlineImageMode,
      story,
      worldState,
      worldStateArrays,
      styleReview,
      agenticRetrievalContext,
      lorebookEntries,
      timelineFillResult,
    )

    try {
      // Stream using the main narrative profile
      const stream = streamNarrative({
        system: systemPrompt,
        prompt: userMessage,
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
    const { worldStateArrays, styleReview, agenticRetrievalContext, lorebookEntries, signal } =
      options

    log('generate', { entriesCount: entries.length })

    const inlineImageMode = story?.settings?.imageGenerationMode === 'inline'

    // Build system prompt and user message via ContextBuilder pipeline
    const { systemPrompt, userMessage } = await this.buildPrompts(
      entries,
      inlineImageMode,
      story,
      worldState,
      worldStateArrays,
      styleReview,
      agenticRetrievalContext,
      lorebookEntries,
    )

    return generateNarrative({
      system: systemPrompt,
      prompt: userMessage,
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
    entries: StoryEntry[],
    inlineImageMode: boolean,
    story: Story | null | undefined,
    worldState: NarrativeWorldState,
    worldStateArrays?: WorldStateArrays,
    styleReview?: StyleReviewResult | null,
    agenticRetrievalContext?: string | null,
    lorebookEntries?: ContextLorebookEntry[],
    timelineFillResult?: TimelineFillResult | null,
  ): Promise<{ systemPrompt: string; userMessage: string }> {
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

    // Map story entries via mapper and add to context for template rendering
    const storyEntries = mapStoryEntriesToContext(entries, { stripPicTags: !inlineImageMode })
    ctx.add({ storyEntries })

    // Add runtime variables for template rendering
    // These are pre-formatted blocks that templates inject via {{ variable }}

    if (worldStateArrays) {
      ctx.add({ ...worldStateArrays })
    }

    if (lorebookEntries && lorebookEntries.length > 0) {
      ctx.add({ lorebookEntries })
    }
    if (agenticRetrievalContext) {
      ctx.add({ agenticRetrievalContext })
    }

    // Build chapter context arrays via mapper
    if (worldState.chapters && worldState.chapters.length > 0) {
      const { chapters, timelineFill } = mapChaptersToContext(
        worldState.chapters,
        timelineFillResult,
      )
      ctx.add({ chapters, timelineFill })
    }

    // Inject style review for template rendering
    if (styleReview && styleReview.phrases.length > 0) {
      ctx.add({ styleReview })
    }

    // Render through the mode-specific template -- user field comes from ${templateId}-user template
    const templateId = mode === 'creative-writing' ? 'creative-writing' : 'adventure'
    const { system: systemPrompt, user: userMessage } = await ctx.render(templateId)

    log('buildPrompts complete', {
      mode,
      templateId,
      systemPromptLength: systemPrompt.length,
      userMessageLength: userMessage.length,
    })

    return { systemPrompt, userMessage }
  }
}
