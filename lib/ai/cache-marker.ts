import type { LanguageModelMiddleware } from 'ai'

/**
 * Marks the last system message as an Anthropic cache breakpoint. Must run last, so the marked
 * block includes the structured-output contract (architecture.md → System and user halves).
 */
export function anthropicCacheMarkerMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const lastSystemIdx = params.prompt.findLastIndex((msg) => msg.role === 'system')
      if (lastSystemIdx === -1) return params
      return {
        ...params,
        prompt: params.prompt.map((msg, i) =>
          i === lastSystemIdx
            ? {
                ...msg,
                providerOptions: {
                  ...msg.providerOptions,
                  anthropic: {
                    ...msg.providerOptions?.anthropic,
                    cacheControl: { type: 'ephemeral' },
                  },
                },
              }
            : msg,
        ),
      }
    },
  }
}
