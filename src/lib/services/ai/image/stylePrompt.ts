/**
 * Image style templates are external: raw text fetched straight from the pack, never
 * rendered through `ContextBuilder`. They still live in a pack, so they resolve the same
 * way its Liquid templates do -- the story's pack, then `default-pack`, then the built-in.
 */

import { database } from '$lib/services/database'
import { DEFAULT_FALLBACK_STYLE_PROMPT } from './constants'

/** Resolve a style template through the story's pack. `storyId` is undefined in the Vault. */
export async function resolveStylePrompt(
  storyId: string | undefined,
  styleId: string,
): Promise<string> {
  try {
    const packId = (storyId ? await database.getStoryPackId(storyId) : null) || 'default-pack'

    const own = await database.getPackTemplate(packId, styleId)
    if (own?.content) return own.content

    if (packId !== 'default-pack') {
      const fallback = await database.getPackTemplate('default-pack', styleId)
      if (fallback?.content) return fallback.content
    }
  } catch {
    // Fall through to the built-in.
  }

  return DEFAULT_FALLBACK_STYLE_PROMPT
}

/** Same, for the wizard and the Vault, which hold a pack directly rather than a story. */
export async function resolveStylePromptForPack(
  packId: string | undefined,
  styleId: string,
): Promise<string> {
  try {
    const own = await database.getPackTemplate(packId || 'default-pack', styleId)
    if (own?.content) return own.content

    if (packId && packId !== 'default-pack') {
      const fallback = await database.getPackTemplate('default-pack', styleId)
      if (fallback?.content) return fallback.content
    }
  } catch {
    // Fall through to the built-in.
  }

  return DEFAULT_FALLBACK_STYLE_PROMPT
}
