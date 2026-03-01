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
import { parseMarkdown } from '$lib/utils/markdown'
import { sanitizeVisualProse } from '$lib/utils/htmlSanitize'
import { renderSinglePicTag, type ImageReplacementInfo } from '$lib/utils/inlineImageParser'
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
      (img.status === 'complete' || img.status === 'generating' || img.status === 'pending') &&
      img.sourceText.length >= 20,
  )
}

/** Find and mark all agentic source text matches, sorted reverse by position (for safe replacement). */
function buildAgenticMarkers(content: string, images: EmbeddedImage[]): ImageMarker[] {
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

  return markers.sort((a, b) => b.start - a.start)
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

// Regex for matching <pic> tags (same as used everywhere else)
const PIC_TAG_REGEX = /<pic\s+([^>]*?)(?:\/>|>\s*<\/pic>)/gi

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
    text = text.replace(PIC_TAG_REGEX, (match) => {
      const placeholder = `PICPH${picIndex++}PICPH`
      const html = renderSinglePicTag(match, imageMap, regeneratingIds)
      placeholderMap.set(placeholder, html)
      return placeholder
    })
  }

  // Step 2: Placeholder-ize agentic sourceText matches
  const markers = buildAgenticMarkers(text, images)
  for (const marker of markers) {
    const originalText = text.slice(marker.start, marker.end)
    const placeholder = `IMGPH${marker.imageId.replace(/-/g, '')}IMGPH`

    const statusClass = regeneratingIds.has(marker.imageId)
      ? 'regenerating'
      : marker.status === 'complete'
        ? 'complete'
        : marker.status === 'generating'
          ? 'generating'
          : 'pending'

    placeholderMap.set(
      placeholder,
      `<span class="embedded-image-link ${statusClass}" data-image-id="${marker.imageId}">${originalText}</span>`,
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
  const agenticMarkers = buildAgenticMarkers(content, images)
  for (const m of agenticMarkers) {
    placedIds.add(m.imageId)
  }

  // Inline images: placed via <pic> tag match
  const imageMap = buildInlineImageMap(images)
  if (imageMap.size > 0) {
    const matches = content.matchAll(new RegExp(PIC_TAG_REGEX.source, 'gi'))
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
 */
export function processStoryContent(
  content: string,
  images: EmbeddedImage[],
  regeneratingIds: Set<string> = new Set(),
): string {
  return processUnified(content, images, regeneratingIds, parseMarkdown)
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
): string {
  return processUnified(content, images, regeneratingIds, (t) => sanitizeVisualProse(t, entryId))
}

// Keep old functions as aliases for backward compatibility (used by StreamingEntry)
export const processContentWithImages = processStoryContent
export const processVisualProseWithImages = processVisualProseStoryContent
export function processContentWithInlineImages(
  content: string,
  images: EmbeddedImage[],
  regeneratingIds: Set<string> = new Set(),
): string {
  return processStoryContent(content, images, regeneratingIds)
}
export function processVisualProseWithInlineImages(
  content: string,
  images: EmbeddedImage[],
  entryId: string,
  regeneratingIds: Set<string> = new Set(),
): string {
  return processVisualProseStoryContent(content, images, entryId, regeneratingIds)
}

export const imageEmbeddingService = {
  processStoryContent,
  processVisualProseStoryContent,
  processContentWithImages,
  processVisualProseWithImages,
  processContentWithInlineImages,
  processVisualProseWithInlineImages,
}
