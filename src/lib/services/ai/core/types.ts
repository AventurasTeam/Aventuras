/**
 * What the narrative stream yields.
 *
 * This file used to carry a whole provider abstraction -- `AIProvider`, `GenerationRequest`,
 * `AgenticResponse`, an OpenAI-shaped tool schema and the OpenRouter reasoning-detail types.
 * All of it predates the move to the Vercel AI SDK, which owns those shapes now, and none of
 * it had a caller left.
 */

/**
 * The name the narrator's stream failures are thrown under: an error the stream itself reported,
 * as opposed to a request refused outright or a fault before any request was sent.
 */
export const STREAM_FAILURE = 'NarrativeStreamError'

export interface StreamChunk {
  content: string
  reasoning?: string
  done: boolean
  /** The response has begun arriving; carries no content of its own. */
  started?: boolean
}
