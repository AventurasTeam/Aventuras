/**
 * Inline Image Parser
 *
 * Parses and extracts <pic> tags from narrative content for inline image generation.
 * Similar to the st-image-auto-generation SillyTavern plugin approach.
 */

/**
 * One `<pic ... />` or `<pic ...></pic>` tag, attributes captured.
 *
 * `[^>]*?` was used here for years and gets the attribute section wrong twice over:
 *
 * - A prompt containing `>` ("a sign reading 10 > 9") ends the match early, so *no* rule
 *   fires. The consequence is not a missing image but the literal `<pic ...>` string
 *   surviving into rendered narration, with `stripPicTags` agreeing there is nothing
 *   there to strip.
 * - It cannot tell a quote that closes an attribute from one inside its value.
 *
 * Matching quoted runs explicitly fixes both: `"[^"]*"` and `'[^']*'` consume a whole
 * value including any `>` in it, and anything outside a quoted run still may not contain
 * `>`, so a genuinely unterminated tag does not swallow the rest of the narration.
 */
const PIC_TAG = String.raw`<pic\s+((?:"[^"]*"|'[^']*'|[^>"'])*?)(?:\/>|>\s*<\/pic>)`

/**
 * A fresh regex for the pic-tag pattern.
 *
 * A function, not a shared constant: with the `g` flag a shared instance carries
 * `lastIndex` between callers, and this pattern is used by six of them across two modules.
 * Exported so `ImageEmbeddingService` -- which does the actual placeholder swap during
 * rendering -- cannot drift from the parser. It had its own copy of the old pattern, so a
 * tag the parser accepted could still be left un-swapped in the rendered narration.
 */
export const picTagRegex = (flags = 'gi') => new RegExp(PIC_TAG, flags)

/**
 * Read one attribute's value, tolerating the other quote character inside it.
 *
 * `["']([^"']+)["']` could not: `prompt="a knight's blade"` captured `a knight`, which then
 * fell under the ten-character floor, so the tag was dropped and the image never generated
 * -- silently, mid-narration, for any prompt containing an apostrophe.
 */
function readAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  if (!match) return null
  return match[2] ?? match[3] ?? null
}

export interface ParsedPicTag {
  /** Full original tag text */
  originalTag: string
  /** Start position in content */
  startIndex: number
  /** End position in content */
  endIndex: number
  /** Image generation prompt */
  prompt: string
  /** Character names for portrait reference */
  characters: string[]
}

/**
 * Extract all <pic> tags from content.
 * Supports both self-closing (<pic ... />) and paired tags (<pic ...></pic>).
 *
 * @param content - The narrative content to parse
 * @returns Array of parsed pic tags with their positions and attributes
 */
export function extractPicTags(content: string): ParsedPicTag[] {
  const tags: ParsedPicTag[] = []

  // Match <pic ... /> or <pic ...></pic>. Handles multiline prompts, various attribute
  // orders, and quotes or angle brackets inside a value -- see PIC_TAG.
  const regex = picTagRegex()

  let match
  while ((match = regex.exec(content)) !== null) {
    const fullMatch = match[0]
    const attributes = match[1]

    // Extract prompt attribute (required)
    const prompt = readAttribute(attributes, 'prompt') ?? ''

    // Extract characters attribute (optional)
    const characters = (readAttribute(attributes, 'characters') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c)

    // Only include tags with valid prompts
    if (prompt && prompt.length >= 10) {
      tags.push({
        originalTag: fullMatch,
        startIndex: match.index,
        endIndex: match.index + fullMatch.length,
        prompt,
        characters,
      })
    }
  }

  return tags
}

/**
 * Check if content contains incomplete <pic tags (for streaming buffer).
 * Used to determine safe render points during streaming.
 *
 * @param content - The content to check
 * @returns Object with incomplete flag and safe end position
 */
export function hasIncompletePicTag(content: string): { incomplete: boolean; safeEnd: number } {
  const lastPicOpen = content.lastIndexOf('<pic')

  if (lastPicOpen === -1) {
    return { incomplete: false, safeEnd: content.length }
  }

  // Whether the last opener has actually closed, decided by the same pattern every other
  // rule uses rather than by looking for the closing characters anywhere after it.
  //
  // The old test was `afterOpen.includes('/>') || afterOpen.includes('</pic>')`, which
  // cannot tell a terminator from the same characters inside an attribute value. A prompt
  // still mid-stream at `<pic prompt="the sign read 10 /> 9` was declared complete, the
  // renderer ran on it, and half a tag reached the page. The same held for a bare `>`.
  //
  // `lastIndexOf` guarantees there is no further opener, so a match can only start at 0:
  // anything else means the text after this opener merely resembles a tag.
  const rest = content.slice(lastPicOpen)
  const match = picTagRegex('i').exec(rest)

  if (match && match.index === 0) {
    return { incomplete: false, safeEnd: content.length }
  }

  return { incomplete: true, safeEnd: lastPicOpen }
}

/**
 * Escape HTML special characters for safe attribute values.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
// ─── Shared SVG fragments ───

const spinnerSvg = (extraClass = '') =>
  `<svg class="placeholder-spinner-svg ${extraClass}" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="80, 200" stroke-dashoffset="0"></circle></svg>`

const imageIconSvg = `<svg class="placeholder-image-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`

const errorIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`

const retryButton = (imageId: string) =>
  `<button class="inline-image-btn retry-btn" data-action="regenerate" data-image-id="${imageId}" title="Retry generation"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg> Retry</button>`

// ─── Shared placeholder builder ───

function buildPlaceholder(
  status: 'generating' | 'failed' | 'pending',
  imageId: string,
  prompt: string,
  innerContent: string,
): string {
  const shimmer = status !== 'failed' ? '<div class="placeholder-shimmer"></div>' : ''
  // No id while streaming and none for a missing record: the attribute is a click target,
  // and an empty one resolves to no image at all.
  const idAttribute = imageId ? ` data-image-id="${imageId}"` : ''
  return `<div class="inline-image-placeholder ${status}"${idAttribute} data-prompt="${escapeHtml(prompt)}">
    ${shimmer}
    <div class="placeholder-content">${innerContent}</div>
  </div>`
}

function loaderWithInfo(statusText: string, shortPrompt: string, spinnerClass = ''): string {
  return `<div class="placeholder-loader">${spinnerSvg(spinnerClass)}${imageIconSvg}</div>
    <div class="placeholder-info">
      <span class="placeholder-status">${statusText}</span>
      <span class="placeholder-prompt">${escapeHtml(shortPrompt)}</span>
    </div>`
}

function errorWithInfo(errorMsg: string, shortPrompt: string, imageId: string): string {
  return `<div class="placeholder-error-icon">${errorIconSvg}</div>
    <div class="placeholder-info">
      <span class="placeholder-status error">${escapeHtml(errorMsg)}</span>
      <span class="placeholder-prompt">${escapeHtml(shortPrompt)}</span>
    </div>
    ${retryButton(imageId)}`
}

/**
 * A tag whose image record is gone: the generation never reached the database, or the
 * record was removed under it. Offering the rescan is the difference between a narration
 * that lost a paragraph's worth of markup for no stated reason and one the reader can fix.
 *
 * A tag with no prompt gets the notice without the button. There is nothing to generate
 * from it, and the placeholder still has to appear: silently rendering it as the empty
 * string is how the markup went missing from the narration in the first place.
 */
function missingRecordInfo(prompt: string, shortPrompt: string): string {
  const action = prompt
    ? `\n    <button class="inline-image-btn create-missing-btn" data-action="create-missing" data-prompt="${escapeHtml(prompt)}" title="Recreate this image">Generate</button>`
    : ''
  return `<div class="placeholder-error-icon">${errorIconSvg}</div>
    <div class="placeholder-info">
      <span class="placeholder-status error">Image record missing</span>
      <span class="placeholder-prompt">${escapeHtml(shortPrompt)}</span>
    </div>${action}`
}

// ─── Completed image renderers ───

function renderCompleteImage(imageId: string, prompt: string, imageData: string): string {
  return `<div class="inline-generated-image" data-image-id="${imageId}" data-prompt="${escapeHtml(prompt)}" data-action="view" role="button" tabindex="0"><img src="data:image/png;base64,${imageData}" alt="${escapeHtml(prompt)}" loading="lazy" /></div>`
}

function renderRegeneratingImage(imageId: string, prompt: string, imageData: string): string {
  return `<div class="inline-generated-image regenerating" data-image-id="${imageId}" data-prompt="${escapeHtml(prompt)}">
    <img src="data:image/png;base64,${imageData}" alt="${escapeHtml(prompt)}" loading="lazy" class="regenerating-image" />
    <div class="regenerating-overlay">
      <div class="regenerating-content">
        <svg class="regenerating-spinner" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="80, 200" stroke-dashoffset="0"></circle></svg>
        <span class="regenerating-text">Regenerating...</span>
      </div>
    </div>
  </div>`
}

export interface PicTagRenderOptions {
  /** Image IDs currently being regenerated. */
  regeneratingIds?: Set<string>
  /** Image IDs waiting long enough to offer a retry. */
  stuckIds?: Set<string>
  /**
   * Offer to recreate a tag that has no image record.
   *
   * Off for the moments after an entry is saved, where its records are still being
   * written and a missing one is the normal state: the recovery rescans the whole entry,
   * so taking it then would create a second record for every tag about to be flushed.
   */
  offerMissingRecovery?: boolean
}

/**
 * Render HTML for a single <pic> tag match.
 * Handles all image states: complete, regenerating, generating, failed, pending, unknown.
 */
export function renderSinglePicTag(
  match: string,
  imageMap: Map<string, ImageReplacementInfo>,
  options: PicTagRenderOptions = {},
): string {
  const { regeneratingIds, stuckIds, offerMissingRecovery = true } = options
  const attrMatch = match.match(picTagRegex('i'))
  const attrs = attrMatch ? attrMatch[1] : ''
  const prompt = readAttribute(attrs, 'prompt') ?? ''
  const shortPrompt = prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt

  const imageInfo = imageMap.get(match)
  if (!imageInfo) {
    return offerMissingRecovery
      ? buildPlaceholder('failed', '', prompt, missingRecordInfo(prompt, shortPrompt))
      : buildPlaceholder(
          'pending',
          '',
          prompt,
          loaderWithInfo('In queue...', shortPrompt, 'pending'),
        )
  }

  const stuck = stuckIds?.has(imageInfo.id) ?? false

  if (imageInfo.status === 'complete' && imageInfo.imageData) {
    return (regeneratingIds?.has(imageInfo.id) ?? false)
      ? renderRegeneratingImage(imageInfo.id, prompt, imageInfo.imageData)
      : renderCompleteImage(imageInfo.id, prompt, imageInfo.imageData)
  }

  if (imageInfo.status === 'generating') {
    return buildPlaceholder(
      'generating',
      imageInfo.id,
      prompt,
      loaderWithInfo('Generating image...', shortPrompt) + (stuck ? retryButton(imageInfo.id) : ''),
    )
  }

  if (imageInfo.status === 'failed') {
    const errorMsg = imageInfo.errorMessage || 'Generation failed'
    return buildPlaceholder(
      'failed',
      imageInfo.id,
      prompt,
      errorWithInfo(errorMsg, shortPrompt, imageInfo.id),
    )
  }

  // Pending
  return buildPlaceholder(
    'pending',
    imageInfo.id,
    prompt,
    loaderWithInfo('In queue...', shortPrompt, 'pending') +
      (stuck ? retryButton(imageInfo.id) : ''),
  )
}

/**
 * Replace <pic> tags with loading placeholders during streaming.
 * Shows a visual placeholder while images are being generated.
 *
 * @param content - The content with <pic> tags
 * @returns Content with placeholders instead of <pic> tags
 */
export function replacePicTagsWithPlaceholders(content: string): string {
  return content.replace(picTagRegex(), (_match, attrs: string) => {
    const prompt = readAttribute(attrs, 'prompt') || 'Image'
    const shortPrompt = prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt
    // No imageId during streaming — use empty string
    return buildPlaceholder(
      'generating',
      '',
      prompt,
      loaderWithInfo('Generating image...', shortPrompt),
    )
  })
}

/**
 * Image info for replacement mapping.
 */
export interface ImageReplacementInfo {
  imageData: string
  status: 'pending' | 'generating' | 'complete' | 'failed'
  id: string
  errorMessage?: string
}

/**
 * Strip all <pic> tags from content, leaving just the text.
 * Useful for word count or plain text extraction.
 *
 * @param content - The content with <pic> tags
 * @returns Content without <pic> tags
 */
export function stripPicTags(content: string): string {
  return content.replace(picTagRegex(), '')
}
