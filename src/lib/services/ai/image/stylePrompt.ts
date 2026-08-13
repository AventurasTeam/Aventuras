/**
 * Image style templates are external: raw text spliced into an image prompt, never rendered
 * through Liquid. They still live in a pack and resolve through the same chain, so the
 * lookup is `ContextBuilder`'s -- only the "nothing usable" tail is ours.
 */

import { database } from '$lib/services/database'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '$lib/log'
import { DEFAULT_FALLBACK_STYLE_PROMPT } from './constants'

const log = createLogger('StylePrompt')

/** Resolve a style template through the story's pack. `storyId` is undefined in the Vault. */
export async function resolveStylePrompt(
  storyId: string | undefined,
  styleId: string,
): Promise<string> {
  let packId = 'default-pack'
  if (storyId) {
    try {
      packId = (await database.getStoryPackId(storyId)) || 'default-pack'
    } catch (error) {
      log('pack lookup failed, using default pack', { storyId, error })
    }
  }
  return resolveStylePromptForPack(packId, styleId)
}

/**
 * Same, for the wizard and the Vault, which hold a pack directly rather than a story.
 *
 * Never throws: an image is worth less than the turn carrying it, and callers splice the
 * result into a prompt rather than branching on it.
 */
export async function resolveStylePromptForPack(
  packId: string | undefined,
  styleId: string,
): Promise<string> {
  try {
    // A plain builder, not `forPackId`: this reads one raw row, and that factory's
    // variable loads are for rendering.
    const template = await new ContextBuilder(packId).resolveTemplate(styleId)
    // Empty is as unusable as missing -- an unstyled image is not what picking a style means.
    if (template?.content) return template.content
  } catch (error) {
    log('style lookup failed, using the built-in style', { packId, styleId, error })
  }
  return DEFAULT_FALLBACK_STYLE_PROMPT
}
