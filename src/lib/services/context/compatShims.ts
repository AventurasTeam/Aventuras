/**
 * Compatibility Shims
 *
 * Computes deprecated pre-formatted variables (tieredContextBlock, chapterSummaries, etc.)
 * for templates that still reference old variable names.
 *
 * Each shim is computed lazily — only when the template source text contains
 * the old variable name. A console warning is emitted once per variable per session.
 *
 * To remove shim support in the future, delete this file and remove the
 * computeShims() call from ContextBuilder.render().
 *
 */

/** Track which deprecated variables have already warned this session */
const warnedVars = new Set<string>()

/**
 * Emit a deprecation warning at most once per variable per session.
 */
function warnOnce(varName: string, replacedBy: string): void {
  if (warnedVars.has(varName)) return
  warnedVars.add(varName)
  console.warn(
    `[ContextBuilder] Template uses deprecated variable "${varName}" — migrate to ${replacedBy}`,
  )
}

// ---------------------------------------------------------------------------
// Shim builder functions
// ---------------------------------------------------------------------------

/**
 * tieredContextBlock — reconstructs the old pre-formatted world-state block.
 * Replicates the format the adventure template now renders via structured arrays.
 */
function buildTieredContextBlock(context: Record<string, unknown>): string {
  const parts: string[] = []

  // Current location
  const locObj = context.currentLocationObject as { name?: string; description?: string } | null
  const locName = context.currentLocation as string | undefined
  if (locObj?.name || locName) {
    parts.push('[CURRENT LOCATION]')
    const name = locObj?.name ?? locName ?? ''
    const desc = locObj?.description ?? ''
    parts.push(desc ? `${name}\n${desc}` : name)
  }

  // Known characters
  type CharEntry = { name?: string; relationship?: string; description?: string }
  const chars = (context.worldStateCharacters as CharEntry[] | undefined) ?? []
  if (chars.length > 0) {
    parts.push('[KNOWN CHARACTERS]')
    for (const char of chars) {
      let line = `• ${char.name ?? ''}`
      if (char.relationship) line += ` (${char.relationship})`
      if (char.description) line += ` - ${char.description}`
      parts.push(line)
    }
  }

  // Inventory
  type ItemEntry = { name?: string; quantity?: number; equipped?: boolean }
  const inventory = (context.worldStateInventory as ItemEntry[] | undefined) ?? []
  if (inventory.length > 0) {
    parts.push('[INVENTORY]')
    const itemParts: string[] = []
    for (const item of inventory) {
      let s = item.name ?? ''
      if (item.quantity && item.quantity > 1) s += ` (×${item.quantity})`
      if (item.equipped) s += ' [equipped]'
      itemParts.push(s)
    }
    parts.push(itemParts.join(', '))
  }

  // Active threads
  type BeatEntry = { title?: string; description?: string }
  const beats = (context.worldStateBeats as BeatEntry[] | undefined) ?? []
  if (beats.length > 0) {
    parts.push('[ACTIVE THREADS]')
    for (const beat of beats) {
      let line = `• ${beat.title ?? ''}`
      if (beat.description) line += `: ${beat.description}`
      parts.push(line)
    }
  }

  // Relevant locations
  type LocEntry = { name?: string; description?: string }
  const locations = (context.worldStateLocations as LocEntry[] | undefined) ?? []
  if (locations.length > 0) {
    parts.push('[RELEVANT LOCATIONS]')
    for (const loc of locations) {
      let line = `• ${loc.name ?? ''}`
      if (loc.description) line += `: ${loc.description}`
      parts.push(line)
    }
  }

  return parts.join('\n\n')
}

/**
 * chapterSummaries — reconstructs the old pre-formatted story history block.
 * Replicates the <story_history> section the adventure template now renders.
 */
function buildChapterSummaries(context: Record<string, unknown>): string {
  type ContextChapter = {
    number?: number
    title?: string
    summary?: string
    startTime?: string | null
    endTime?: string | null
    characters?: string[]
    locations?: string[]
    emotionalTone?: string
  }
  type TimelineFillItem = {
    query?: string
    answer?: string
    chapterNumbers?: number[]
  }

  const chapters = (context.chapters as ContextChapter[] | undefined) ?? []
  const timelineFill = (context.timelineFill as TimelineFillItem[] | undefined) ?? []

  if (chapters.length === 0 && timelineFill.length === 0) return ''

  const lines: string[] = []
  lines.push('<story_history>')
  lines.push('## Previous Chapters')
  lines.push(
    'The following chapters have occurred earlier in the story. Use them for continuity and context.',
  )
  lines.push('')

  for (const c of chapters) {
    const titlePart = c.title ? `: ${c.title}` : ''
    lines.push(`### Chapter ${c.number ?? ''}${titlePart}`)

    if (c.startTime && c.endTime) {
      lines.push(`*Time: ${c.startTime} → ${c.endTime}*`)
    } else if (c.startTime) {
      lines.push(`*Time: ${c.startTime}*`)
    }

    if (c.summary) lines.push(c.summary)

    const metaParts: string[] = []
    if (c.characters && c.characters.length > 0)
      metaParts.push(`Characters: ${c.characters.join(', ')}`)
    if (c.locations && c.locations.length > 0)
      metaParts.push(`Locations: ${c.locations.join(', ')}`)
    if (c.emotionalTone) metaParts.push(`Tone: ${c.emotionalTone}`)
    if (metaParts.length > 0) lines.push(`*${metaParts.join(' | ')}*`)

    lines.push('')
  }

  if (timelineFill.length > 0) {
    lines.push('## Retrieved Context')
    lines.push(
      'The following information was retrieved from past chapters and is relevant to the current scene:',
    )
    lines.push('')

    for (const item of timelineFill) {
      const nums = item.chapterNumbers ?? []
      const chapLabel =
        nums.length === 1 ? `**Chapter ${nums[0]}**` : `**Chapters ${nums.join(', ')}**`
      lines.push(chapLabel)
      lines.push(`Q: ${item.query ?? ''}`)
      lines.push(`A: ${item.answer ?? ''}`)
      lines.push('')
    }
  }

  lines.push('</story_history>')

  return lines.join('\n')
}

/**
 * styleGuidance — reconstructs the old pre-formatted style guidance block.
 * Replicates the logic from StyleReviewerService.formatForPromptInjection().
 */
function buildStyleGuidance(context: Record<string, unknown>): string {
  type PhraseAnalysis = {
    phrase?: string
    frequency?: number
    severity?: string
    alternatives?: string[]
  }
  type StyleReview = {
    phrases?: PhraseAnalysis[]
    overallAssessment?: string
    reviewedEntryCount?: number
  }

  const review = context.styleReview as StyleReview | undefined
  if (!review?.phrases?.length) return ''

  let block = '\n\n<style_guidance>\n'
  block += '## Writing Style Feedback\n'
  block += `Based on analysis of ${review.reviewedEntryCount ?? 0} recent entries:\n\n`

  for (const phrase of review.phrases) {
    block += `- **"${phrase.phrase ?? ''}"** (used ${phrase.frequency ?? 0} times, ${phrase.severity ?? ''} severity)\n`
    if (phrase.alternatives && phrase.alternatives.length > 0) {
      block += `  Alternatives: ${phrase.alternatives.join(', ')}\n`
    }
  }

  block += `\nOverall: ${review.overallAssessment ?? ''}\n`
  block += '</style_guidance>'

  return block
}

/**
 * lorebookContext — reconstructs the old pre-formatted lorebook text block.
 * Replicates the flat text list that the old EntryRetrievalService.buildContextBlock() produced.
 */
function buildLorebookContext(context: Record<string, unknown>): string {
  type LorebookEntry = { name?: string; description?: string }
  const entries = (context.lorebookEntries as LorebookEntry[] | undefined) ?? []
  if (entries.length === 0) return ''

  return entries.map((e) => `${e.name ?? ''}: ${e.description ?? ''}`).join('\n')
}

/**
 * recentContext — reconstructs a flat text block from storyEntries[].
 * Behavior is template-aware to match the old per-service injection patterns.
 */
function buildRecentContext(context: Record<string, unknown>, templateId: string): string {
  type StoryEntry = { type?: string; content?: string }
  const entries = (context.storyEntries as StoryEntry[] | undefined) ?? []
  if (entries.length === 0) return ''

  // Memory-related templates: join narration-type entries only
  const memoryTemplates = ['retrieval-decision', 'chapter-summarization', 'chapter-analysis']
  if (memoryTemplates.includes(templateId)) {
    return entries
      .filter((e) => e.type === 'narration')
      .map((e) => e.content ?? '')
      .join('\n')
  }

  // Action choices / suggestions: join all entries
  if (templateId === 'action-choices' || templateId === 'suggestions') {
    return entries.map((e) => e.content ?? '').join('\n')
  }

  // Default: narration entries only
  return entries
    .filter((e) => e.type === 'narration')
    .map((e) => e.content ?? '')
    .join('\n')
}

// ---------------------------------------------------------------------------
// Instruction text for compat shims (verbatim from NarrativeService.ts)
// ---------------------------------------------------------------------------

/**
 * Full instruction text for inline image generation via <pic> tags.
 * Kept here for templates that still reference {{ inlineImageInstructions }}.
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
 * Kept here for templates that still reference {{ visualProseInstructions }}.
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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute compatibility shims for deprecated template variables.
 *
 * Only computes values for variables that are actually referenced in the
 * combined template source text. Returns a plain object with only the keys
 * that were detected — inject into context only where key is not already set.
 *
 * @param context - Current render context
 * @param templateSource - Combined system + user template source text
 * @param templateId - Template ID (used by recentContext shim)
 * @returns Partial record of shim values to inject
 */
export function computeShims(
  context: Record<string, unknown>,
  templateSource: string,
  templateId: string,
): Record<string, string> {
  const shims: Record<string, string> = {}

  if (templateSource.includes('tieredContextBlock')) {
    warnOnce(
      'tieredContextBlock',
      'worldStateCharacters[], worldStateInventory[], worldStateBeats[], worldStateLocations[]',
    )
    shims['tieredContextBlock'] = buildTieredContextBlock(context)
  }

  if (templateSource.includes('chapterSummaries')) {
    warnOnce('chapterSummaries', 'chapters[], timelineFill[]')
    shims['chapterSummaries'] = buildChapterSummaries(context)
  }

  if (templateSource.includes('styleGuidance')) {
    warnOnce('styleGuidance', 'styleReview')
    shims['styleGuidance'] = buildStyleGuidance(context)
  }

  if (templateSource.includes('lorebookContext')) {
    warnOnce('lorebookContext', 'lorebookEntries[]')
    shims['lorebookContext'] = buildLorebookContext(context)
  }

  if (templateSource.includes('recentContext')) {
    warnOnce('recentContext', 'storyEntries[]')
    shims['recentContext'] = buildRecentContext(context, templateId)
  }

  if (templateSource.includes('inlineImageInstructions')) {
    warnOnce('inlineImageInstructions', 'inlineImageMode')
    shims['inlineImageInstructions'] = context.inlineImageMode ? INLINE_IMAGE_INSTRUCTIONS : ''
  }

  if (templateSource.includes('visualProseInstructions')) {
    warnOnce('visualProseInstructions', 'visualProseMode')
    shims['visualProseInstructions'] = context.visualProseMode ? VISUAL_PROSE_INSTRUCTIONS : ''
  }

  return shims
}
