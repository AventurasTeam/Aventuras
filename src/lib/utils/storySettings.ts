import type { ImageGenerationMode, StorySettings } from '$lib/types'

export const IMAGE_GENERATION_MODES: readonly ImageGenerationMode[] = ['none', 'agentic', 'inline']

/**
 * A story's settings as they come off disk. An image mode that is not a current value (older
 * versions saved `'auto'`) is dropped, so the story reads as having no mode chosen. Nothing is
 * written back, so this runs on every read.
 */
export function readStorySettings(stored: StorySettings | null): StorySettings | null {
  if (!stored) return null
  const { imageGenerationMode, ...rest } = stored
  return imageGenerationMode && IMAGE_GENERATION_MODES.includes(imageGenerationMode) ? stored : rest
}
