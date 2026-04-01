/**
 * Logging Middleware
 *
 * Logs the full prompt and output. Place LAST in middleware chain.
 */

import type { LanguageModelV3Middleware, LanguageModelV3Prompt } from '@ai-sdk/provider'
import { createLogger } from '$lib/log'

const log = createLogger('AI')

function promptToString(prompt: LanguageModelV3Prompt): string {
  return prompt
    .map((msg) => {
      const role = msg.role.toUpperCase()

      if (msg.role === 'system') {
        return `[${role}]\n${msg.content}`
      }

      if (msg.role === 'user' || msg.role === 'assistant') {
        const content = msg.content
          .map((part) => {
            if (part.type === 'text') return part.text
            if (part.type === 'reasoning') return `[REASONING]\n${part.text}`
            if (part.type === 'tool-call') return `[TOOL: ${part.toolName}]`
            return `[${part.type.toUpperCase()}]`
          })
          .join('\n')
        return `[${role}]\n${content}`
      }

      if (msg.role === 'tool') {
        return `[TOOL RESULT]\n${JSON.stringify(msg.content, null, 2)}`
      }

      return `[${role}]\n${JSON.stringify(msg, null, 2)}`
    })
    .join('\n\n---\n\n')
}

function extractText(content: Array<{ type: string; text?: string }>): string | undefined {
  return content.find((p) => p.type === 'text' && p.text)?.text
}

export function loggingMiddleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate, params }) => {
      log('=== REQUEST ===')
      log('Prompt:\n' + promptToString(params.prompt))
      if (params.responseFormat) {
        log('Response Format:', JSON.stringify(params.responseFormat, null, 2))
      }

      const result = await doGenerate()

      log('=== RESPONSE ===')
      const text = extractText(result.content)
      if (text) log('Text:', text)

      const r = result as Record<string, unknown>
      if (r.output) log('Output:', JSON.stringify(r.output, null, 2))
      if (result.usage) log('Usage:', result.usage)
      if (result.finishReason) log('Finish Reason:', result.finishReason)
      if (result.providerMetadata) {
        log('Provider Metadata:', JSON.stringify(result.providerMetadata, null, 2))
      }

      return result
    },

    wrapStream: async ({ doStream, params }) => {
      const startTime = Date.now()
      log('=== STREAM REQUEST ===')
      log('Prompt:\n' + promptToString(params.prompt))
      if (params.responseFormat) {
        log('Response Format:', JSON.stringify(params.responseFormat, null, 2))
      }

      const { stream, ...rest } = await doStream()
      log('=== STREAM STARTED ===')

      return {
        ...rest,
        stream: stream.pipeThrough(
          new TransformStream({
            flush() {
              const duration = Date.now() - startTime
              log(`=== STREAM FINISHED (${duration}ms) ===`)
            },
          }),
        ),
      }
    },
  }
}
