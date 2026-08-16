/**
 * ImageEmbeddingService - Processes narrative content to render embedded images inline.
 *
 * Uses a unified "agnostic" pipeline that handles BOTH agentic (sourceText-matched)
 * and inline (<pic> tag) images in a single pass, regardless of the current
 * imageGenerationMode setting. This ensures correct rendering when switching modes mid-story.
 *
 * Pipeline:
 * 1. Extract <pic> tags → replace with placeholders
 * 2. Extract agentic sourceText matches → replace with placeholders
 * 3. Run renderer (parseMarkdown or sanitizeVisualProse) on clean text
 * 4. Swap all placeholders back with final HTML
 */

import type { EmbeddedImage } from '$lib/types'
import { parseStoryMarkdown, parseStoryMarkdownInline } from '$lib/utils/markdown'
import { dialogueSpans } from '$lib/utils/dialogue'
import { sanitizeVisualProse } from '$lib/utils/htmlSanitize'
import {
  picTagRegex,
  renderSinglePicTag,
  type ImageReplacementInfo,
  type PicTagRenderOptions,
} from '$lib/utils/inlineImageParser'
import { createFuzzyTextRegex } from '$lib/utils/text'

interface ImageMarker {
  start: number
  end: number
  imageId: string
  status: string
}

/** Filter to agentic images that can be displayed as text-linked markers. */
function getDisplayableAgenticImages(images: EmbeddedImage[]): EmbeddedImage[] {
  return images.filter(
    (img) =>
      img.generationMode !== 'inline' &&
      (img.status === 'complete' ||
        img.status === 'generating' ||
        img.status === 'pending' ||
        img.status === 'failed') &&
      img.sourceText.length >= 20,
  )
}

/**
 * Find and mark all agentic source text matches, sorted reverse by position (for safe
 * replacement).
 *
 * `snapToDialogue` is off wherever dialogue is not a concept. In Visual Prose the
 * content is generated HTML and the feature is deliberately absent, so widening a
 * marker there can only do harm: it would grow the marker over markup on the strength
 * of a "quote" that is really an attribute value. `getPlacedImageIds` turns it off for
 * a different reason — widening cannot change which images are placed, only where.
 */
function buildAgenticMarkers(
  content: string,
  images: EmbeddedImage[],
  snapToDialogue: boolean,
): ImageMarker[] {
  const snapped = snapToDialogue
    ? snapMarkersToDialogue(content, rawMarkers(content, images))
    : rawMarkers(content, images)
  return [...snapped].sort((a, b) => b.start - a.start)
}

/**
 * Raw-marker runs, keyed by the narration they were found in.
 *
 * Both readers — the renderer and the orphan gallery — ask the same question about the
 * same entry, and the answer costs a fuzzy regex pass per image over the whole narration.
 * Only the snapping differs between them, and that runs on the result. They are reached
 * from different reactive contexts, so a single slot would be evicted by the next entry
 * before the second reader arrives.
 */
const RAW_MARKER_CACHE_LIMIT = 32
const rawMarkerCache = new Map<string, { signature: string; markers: ImageMarker[] }>()

/**
 * Keyed on the narration itself, so entries of the story being left never come up again.
 * Called where the story or the branch changes, next to `clearTier3SelectionCache`.
 */
export function clearImageMarkerCache(): void {
  rawMarkerCache.clear()
}

function markerSignature(images: EmbeddedImage[]): string {
  return images.map((img) => `${img.id}:${img.status}:${img.sourceText}`).join('\u0000')
}

function rawMarkers(content: string, images: EmbeddedImage[]): ImageMarker[] {
  const signature = markerSignature(images)
  const cached = rawMarkerCache.get(content)
  if (cached?.signature === signature) {
    // Re-set to move the key to the end: eviction takes the first key, so without this a
    // steadily re-read entry is dropped on age rather than on disuse.
    rawMarkerCache.delete(content)
    rawMarkerCache.set(content, cached)
    return cached.markers
  }

  const markers = findAgenticMarkers(content, images)
  rawMarkerCache.set(content, { signature, markers })
  if (rawMarkerCache.size > RAW_MARKER_CACHE_LIMIT) {
    const oldest = rawMarkerCache.keys().next().value
    if (oldest !== undefined) rawMarkerCache.delete(oldest)
  }
  return markers
}

function findAgenticMarkers(content: string, images: EmbeddedImage[]): ImageMarker[] {
  const displayable = getDisplayableAgenticImages(images)
  const sortedImages = [...displayable].sort((a, b) => b.sourceText.length - a.sourceText.length)
  const markers: ImageMarker[] = []

  for (const img of sortedImages) {
    const regex = createFuzzyTextRegex(img.sourceText)

    let match
    while ((match = regex.exec(content)) !== null) {
      const start = match.index
      const end = start + match[0].length

      const overlaps = markers.some(
        (m) =>
          (start >= m.start && start < m.end) ||
          (end > m.start && end <= m.end) ||
          (start <= m.start && end >= m.end),
      )

      if (!overlaps) {
        markers.push({ start, end, imageId: img.id, status: img.status })
      }
    }
  }

  return markers
}

/**
 * Widen any marker that cuts a dialogue span so it covers the whole quote.
 *
 * A marker's text is lifted out of the content before rendering, so a marker ending
 * mid-quote leaves an unterminated quote behind — which is deliberately not treated
 * as dialogue, and the line loses its colour with nothing to explain why. Since a
 * `sourceText` is often mostly dialogue, the fix is to swallow the rest of the quote
 * rather than to stop before it: trimming back can shrink an image's anchor to a few
 * words, while extending it costs a slightly longer clickable run.
 *
 * A marker that cannot grow without colliding with another one is left exactly as it
 * was — an overlap would corrupt both replacements, which is worse than a quote that
 * is not coloured.
 */
function snapMarkersToDialogue(content: string, markers: ImageMarker[]): ImageMarker[] {
  const spans = dialogueSpans(content)
  if (spans.length === 0) return markers

  return markers.map((marker, index) => {
    let { start, end } = marker

    // Growing over one span can bring the marker into contact with the next, so
    // repeat until it stops moving.
    let changed = true
    while (changed) {
      changed = false
      for (const span of spans) {
        const intersects = start < span.end && span.start < end
        const contains = start <= span.start && end >= span.end
        if (!intersects || contains) continue

        start = Math.min(start, span.start)
        end = Math.max(end, span.end)
        changed = true
      }
    }

    if (start === marker.start && end === marker.end) return marker

    const collides = markers.some((other, otherIndex) => {
      if (otherIndex === index) return false
      return start < other.end && other.start < end
    })

    return collides ? marker : { ...marker, start, end }
  })
}

/** Build image map for inline <pic> tag replacement. */
function buildInlineImageMap(images: EmbeddedImage[]): Map<string, ImageReplacementInfo> {
  const imageMap = new Map<string, ImageReplacementInfo>()
  for (const img of images) {
    if (img.generationMode === 'inline') {
      imageMap.set(img.sourceText, {
        imageData: img.imageData,
        status: img.status,
        id: img.id,
        errorMessage: img.errorMessage,
      })
    }
  }
  return imageMap
}

/**
 * Unified rendering pipeline that handles both agentic and inline images.
 *
 * 1. Replace <pic> tags with safe placeholders (PICPH_n)
 * 2. Replace agentic sourceText matches with safe placeholders (IMGPH_xxx)
 * 3. Run the renderer (markdown or visual prose) on clean text
 * 4. Swap all placeholders back with the final HTML
 */
function processUnified(
  content: string,
  images: EmbeddedImage[],
  regeneratingIds: Set<string>,
  render: (text: string) => string,
  renderMarkerText: (text: string) => string,
  snapToDialogue: boolean,
  picOptions: PicTagRenderOptions,
): string {
  if (images.length === 0 && !content.includes('<pic')) {
    return render(content)
  }

  let text = content
  const placeholderMap = new Map<string, string>()

  // Step 1: Placeholder-ize <pic> tags (inline images)
  const imageMap = buildInlineImageMap(images)
  const hasPicTags = content.includes('<pic')

  if (hasPicTags) {
    let picIndex = 0
    text = text.replace(picTagRegex(), (match) => {
      const placeholder = `PICPH${picIndex++}PICPH`
      const html = renderSinglePicTag(match, imageMap, { ...picOptions, regeneratingIds })
      placeholderMap.set(placeholder, html)
      return placeholder
    })
  }

  // Step 2: Placeholder-ize agentic sourceText matches
  const markers = buildAgenticMarkers(text, images, snapToDialogue)
  for (const marker of markers) {
    const originalText = text.slice(marker.start, marker.end)
    const placeholder = `IMGPH${marker.imageId.replace(/-/g, '')}IMGPH`

    const statusClass = regeneratingIds.has(marker.imageId)
      ? 'regenerating'
      : marker.status === 'complete'
        ? 'complete'
        : marker.status === 'generating'
          ? 'generating'
          : marker.status === 'failed'
            ? 'failed'
            : 'pending'

    // Render the marker's own text rather than splicing it back raw: it is lifted out
    // before the renderer runs, so anything inside it — dialogue, emphasis — would
    // otherwise reach the page unparsed, as literal asterisks and uncoloured quotes.
    placeholderMap.set(
      placeholder,
      `<span class="embedded-image-link ${statusClass}" data-image-id="${marker.imageId}">${renderMarkerText(originalText)}</span>`,
    )
    text = text.slice(0, marker.start) + placeholder + text.slice(marker.end)
  }

  // Step 3: Render (markdown or visual prose) on the clean text
  let html = render(text)

  // Step 4: Swap all placeholders back with the real HTML
  for (const [placeholder, replacement] of placeholderMap) {
    html = html.replaceAll(placeholder, replacement)
  }

  return html
}

/**
 * Get the IDs of images that would be successfully placed in the content.
 * Combines agentic (sourceText match) and inline (<pic> tag match) placed images.
 * Used by the orphaned images gallery to determine which images are unplaced.
 */
export function getPlacedImageIds(content: string, images: EmbeddedImage[]): Set<string> {
  if (images.length === 0) return new Set()

  const placedIds = new Set<string>()

  // Agentic images: placed via sourceText match
  const agenticMarkers = buildAgenticMarkers(content, images, false)
  for (const m of agenticMarkers) {
    placedIds.add(m.imageId)
  }

  // Inline images: placed via <pic> tag match
  const imageMap = buildInlineImageMap(images)
  if (imageMap.size > 0) {
    const matches = content.matchAll(picTagRegex())
    for (const match of matches) {
      const imageInfo = imageMap.get(match[0])
      if (imageInfo) {
        placedIds.add(imageInfo.id)
      }
    }
  }

  return placedIds
}

/**
 * Process story content with all embedded images (agnostic to mode).
 * Handles both agentic markers and inline <pic> tags in a single pass.
 *
 * Renders through `parseStoryMarkdown`, which additionally marks up dialogue. The
 * Visual Prose path below deliberately does not: that content is authored HTML and
 * goes through `sanitizeVisualProse` instead, which is what keeps the dialogue
 * feature off for those stories without a mode check anywhere.
 */
export function processStoryContent(
  content: string,
  images: EmbeddedImage[],
  regeneratingIds: Set<string> = new Set(),
  picOptions: Omit<PicTagRenderOptions, 'regeneratingIds'> = {},
): string {
  return processUnified(
    content,
    images,
    regeneratingIds,
    parseStoryMarkdown,
    parseStoryMarkdownInline,
    true,
    picOptions,
  )
}

/**
 * Process Visual Prose story content with all embedded images (agnostic to mode).
 * Handles both agentic markers and inline <pic> tags in a single pass.
 */
export function processVisualProseStoryContent(
  content: string,
  images: EmbeddedImage[],
  entryId: string,
  regeneratingIds: Set<string> = new Set(),
  picOptions: Omit<PicTagRenderOptions, 'regeneratingIds'> = {},
): string {
  // Marker text stays raw here: in this mode it is already HTML, and running it
  // through a markdown renderer would mangle the tags it is made of.
  return processUnified(
    content,
    images,
    regeneratingIds,
    (t) => sanitizeVisualProse(t, entryId),
    (t) => t,
    false,
    picOptions,
  )
}
