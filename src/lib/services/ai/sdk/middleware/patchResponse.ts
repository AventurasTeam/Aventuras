/**
 * Patch Response Middleware
 *
 * Fixes provider response issues that cause SDK validation errors.
 */

import type { LanguageModelV3Middleware } from '@ai-sdk/provider'
import { createLogger } from '$lib/log'

const log = createLogger('PatchResponse')

interface UsageV6 {
  inputTokens: { total: number }
  outputTokens: { total: number }
}

const DEFAULT_USAGE: UsageV6 = {
  inputTokens: { total: 0 },
  outputTokens: { total: 0 },
}

function ensureUsage(usage: unknown): UsageV6 {
  if (!usage || typeof usage !== 'object') {
    return DEFAULT_USAGE
  }

  const u = usage as Record<string, unknown>

  if (u.inputTokens && typeof u.inputTokens === 'object') {
    return usage as UsageV6
  }

  return {
    inputTokens: { total: typeof u.promptTokens === 'number' ? u.promptTokens : 0 },
    outputTokens: { total: typeof u.completionTokens === 'number' ? u.completionTokens : 0 },
  }
}

export function patchResponseMiddleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()

      if (!result.usage) log('Patching null usage')
      ;(result as { usage: UsageV6 }).usage = ensureUsage(result.usage)

      if (!result.finishReason) {
        log('Patching missing finishReason')
        result.finishReason = { unified: 'stop', raw: 'stop' }
      }

      return result
    },

    wrapStream: async ({ doStream }) => doStream(),
  }
}
