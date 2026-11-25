import type { ImageGenerationMode, POV, Story, StorySettings, Tense } from '#lib/types/index.ts'

export const IMAGE_GENERATION_MODES: readonly ImageGenerationMode[] = ['none', 'agentic', 'inline']

type Voiced = Pick<Story, 'mode' | 'settings'>

/** The perspective a story is written in. */
export function storyPov(story: Voiced | null | undefined): POV {
  return story?.settings?.pov ?? (story?.mode === 'creative-writing' ? 'third' : 'first')
}

/** The tense a story is written in. */
export function storyTense(story: Voiced | null | undefined): Tense {
  return story?.settings?.tense ?? 'present'
}

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
