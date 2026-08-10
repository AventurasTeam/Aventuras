/**
 * What the narrative stream yields.
 *
 * This file used to carry a whole provider abstraction -- `AIProvider`, `GenerationRequest`,
 * `AgenticResponse`, an OpenAI-shaped tool schema and the OpenRouter reasoning-detail types.
 * All of it predates the move to the Vercel AI SDK, which owns those shapes now, and none of
 * it had a caller left.
 */

export interface StreamChunk {
  content: string
  reasoning?: string
  done: boolean
}
