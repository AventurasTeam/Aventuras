/**
 * Unique Tool Call ID Middleware
 *
 * Some providers (e.g. Google Generative AI) reuse tool call IDs across steps,
 * using a scheme like `functions.{toolName}:{index}` that resets per step.
 * When the same tool is called in sequential steps, both get id `functions.tool:0`,
 * creating ambiguous conversation history that breaks result matching.
 *
 * This middleware replaces provider-generated IDs with UUIDs. Because `wrapStream`
 * is invoked once per provider API call (one per agentic step), the idMap is
 * naturally scoped to a single step — so identical original IDs across steps
 * resolve to different UUIDs.
 */

import type { LanguageModelV3Middleware } from '@ai-sdk/provider'

export function uniqueToolCallIdMiddleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',

    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()

      const idMap = new Map<string, string>()
      function uniqueId(originalId: string): string {
        if (!idMap.has(originalId)) {
          idMap.set(originalId, crypto.randomUUID())
        }
        return idMap.get(originalId)!
      }

      const patched = stream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            if (chunk.type === 'tool-call') {
              controller.enqueue({ ...chunk, toolCallId: uniqueId(chunk.toolCallId) })
            } else {
              controller.enqueue(chunk)
            }
          },
        }),
      )

      return { stream: patched, ...rest }
    },

    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      if (result.content) {
        result.content = result.content.map((part) =>
          part.type === 'tool-call' ? { ...part, toolCallId: crypto.randomUUID() } : part,
        )
      }
      return result
    },
  }
}
