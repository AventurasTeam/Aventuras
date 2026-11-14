import { requireModelDir } from './paths'
import { countTokens, embed, smokeTest } from './service'
import type { EmbedderBridge } from './types'

/** The embedder calls a run makes, as main's IPC handlers answer them. */
export type EmbedderCallHandlers = Pick<
  EmbedderBridge,
  'embed' | 'countTokens' | 'smokeTest' | 'cancelEmbed'
>

/** The calls over the models under `root`, userData's embedders/ by default. */
export function embedderCallHandlers(root?: string): EmbedderCallHandlers {
  // Keyed by the renderer's requestId; a cancel lands on the service's next chunk boundary.
  const embedAborts = new Map<string, AbortController>()
  return {
    async embed({ modelId, texts, requestId }) {
      const controller = new AbortController()
      // Set before any await: a cancel sent after this call on the ordered IPC channel finds it.
      if (requestId != null) embedAborts.set(requestId, controller)
      try {
        return await embed({
          modelDir: requireModelDir(modelId, root),
          texts,
          signal: controller.signal,
        })
      } finally {
        // Identity check: a reused requestId's live entry must outlive the earlier call's exit.
        if (requestId != null && embedAborts.get(requestId) === controller) {
          embedAborts.delete(requestId)
        }
      }
    },
    async countTokens({ modelId, texts }) {
      return countTokens({ modelDir: requireModelDir(modelId, root), texts })
    },
    async smokeTest({ modelId }) {
      return smokeTest({ modelDir: requireModelDir(modelId, root) })
    },
    async cancelEmbed({ requestId }) {
      embedAborts.get(requestId)?.abort()
    },
  }
}
