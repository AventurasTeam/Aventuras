import type { Story, StoryDetails } from '$lib/types'

/**
 * The columns a story's edited details change, or `null` when they change nothing — the library
 * card must not move to the top of the list for a save that stored no edit.
 *
 * Blank genre and description clear their column; a blank title is refused, since a story with
 * no name cannot be found again.
 */
export function storyDetailsUpdate(stored: Story, details: StoryDetails): Partial<Story> | null {
  const title = details.title.trim()
  if (!title) return null

  const genre = details.genre?.trim() || null
  const description = details.description?.trim() || null
  const genreColor = details.genreColor || null

  const updates: Partial<Story> = {}
  if (title !== stored.title) updates.title = title
  if (genre !== (stored.genre || null)) updates.genre = genre
  if (description !== (stored.description || null)) updates.description = description
  if (genreColor !== (stored.settings?.genreColor || null)) {
    // `updateStory` replaces the settings JSON whole, so the rest of it is carried over here.
    const { genreColor: _previous, ...rest } = stored.settings ?? {}
    updates.settings = genreColor ? { ...rest, genreColor } : rest
  }

  return Object.keys(updates).length > 0 ? updates : null
}
