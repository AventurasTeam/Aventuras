// AI-specific debug logging for the SDK transports: Gemini safety metadata and stream aggregation.
// The generic request/response helpers live in `#lib/services/http`.

import { createResponseLogger, logReadFailure, type DebugEntry } from '#lib/services/http/index.ts'
import { debugLog } from '#lib/stores/debugLog.ts'

interface ProviderMetadata {
  promptFeedback?: unknown
  safetyRatings?: unknown
}

/** The Gemini safety fields worth surfacing next to a response body. */
export function providerMetadataOf(payload: unknown): ProviderMetadata | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  // A key with no value stays absent: `Object.assign` across stream chunks would let an
  // explicit `undefined` wipe the value from an earlier chunk.
  const metadata: ProviderMetadata = {}
  if ('promptFeedback' in payload && payload.promptFeedback) {
    metadata.promptFeedback = payload.promptFeedback
  }
  if ('candidates' in payload && Array.isArray(payload.candidates)) {
    const first: unknown = payload.candidates[0]
    if (
      typeof first === 'object' &&
      first !== null &&
      'safetyRatings' in first &&
      first.safetyRatings
    ) {
      metadata.safetyRatings = first.safetyRatings
    }
  }
  return nonEmpty(metadata)
}

function nonEmpty(metadata: ProviderMetadata): ProviderMetadata | undefined {
  return metadata.promptFeedback || metadata.safetyRatings ? metadata : undefined
}

/** Like the generic dispatcher, but any other success is a stream: the SDK's chat endpoints send SSE. */
export const logSdkResponse = createResponseLogger({
  describeJson: (body) => ({ providerMetadata: providerMetadataOf(body) }),
  // A clone: the SDK reads the original.
  logOther: (response, entry) => void logStreamResponse(response.clone(), entry),
})

interface ToolCallDelta {
  index: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: unknown }
}

interface ChoiceChunk {
  index: number
  delta?: {
    role?: string
    content?: string
    reasoning?: string
    tool_calls?: ToolCallDelta[]
  }
  finish_reason?: string | null
}

interface CompletionChunk {
  id?: string
  model?: string
  choices: ChoiceChunk[]
}

interface AggregatedToolCall {
  index: number
  id: string
  type: string
  function: { name: string; arguments: string; parsed_arguments?: unknown }
}

interface AggregatedChoice {
  index: number
  message: {
    role: string
    content: string
    reasoning?: string
    tool_calls?: AggregatedToolCall[]
  }
  finish_reason: string | null
}

function isCompletionChunk(value: unknown): value is CompletionChunk {
  return (
    typeof value === 'object' &&
    value !== null &&
    'choices' in value &&
    Array.isArray(value.choices)
  )
}

export async function logStreamResponse(response: Response, entry: DebugEntry): Promise<void> {
  const { debugId, serviceId, startTime } = entry
  try {
    const text = await response.text()
    let parsedBody: unknown = text
    const providerMetadata: ProviderMetadata = {}
    try {
      const chunks = text.split('\n\n').filter((c) => c.trim())
      const parsedChunks = chunks.map((chunk): unknown => {
        if (chunk.startsWith('data: ')) {
          const dataStr = chunk.slice(6)
          if (dataStr === '[DONE]') return { done: true }
          try {
            const parsed: unknown = JSON.parse(dataStr)
            Object.assign(providerMetadata, providerMetadataOf(parsed))
            return parsed
          } catch {
            return chunk
          }
        }
        return chunk
      })

      const aggregatedChoices = new Map<number, AggregatedChoice>()
      let aggregatedId = ''
      let aggregatedModel = ''
      let hasAggregation = false

      for (const chunk of parsedChunks) {
        if (!isCompletionChunk(chunk)) continue
        hasAggregation = true
        if (chunk.id) aggregatedId = chunk.id
        if (chunk.model) aggregatedModel = chunk.model

        for (const choice of chunk.choices) {
          let agg = aggregatedChoices.get(choice.index)
          if (!agg) {
            agg = {
              index: choice.index,
              message: { role: 'assistant', content: '' },
              finish_reason: null,
            }
            aggregatedChoices.set(choice.index, agg)
          }
          const delta = choice.delta ?? {}
          if (delta.role) agg.message.role = delta.role
          if (delta.content) agg.message.content += delta.content
          if (delta.reasoning)
            agg.message.reasoning = (agg.message.reasoning || '') + delta.reasoning
          if (delta.tool_calls) {
            const toolCalls = (agg.message.tool_calls ??= [])
            for (const tc of delta.tool_calls) {
              let aggTc = toolCalls.find((t) => t.index === tc.index)
              if (!aggTc) {
                aggTc = {
                  index: tc.index,
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                }
                toolCalls.push(aggTc)
              }
              if (tc.id) aggTc.id = tc.id
              if (tc.type) aggTc.type = tc.type
              if (tc.function?.name) aggTc.function.name = tc.function.name
              if (typeof tc.function?.arguments === 'string')
                aggTc.function.arguments += tc.function.arguments
            }
          }
          if (choice.finish_reason !== undefined && choice.finish_reason !== null)
            agg.finish_reason = choice.finish_reason
        }
      }

      if (hasAggregation) {
        const finalChoices = [...aggregatedChoices.values()]
        for (const choice of finalChoices) {
          for (const tc of choice.message.tool_calls ?? []) {
            try {
              tc.function.parsed_arguments = JSON.parse(tc.function.arguments)
            } catch {}
          }
        }

        parsedBody = {
          _note: 'Aggregated from stream',
          id: aggregatedId,
          model: aggregatedModel,
          choices: finalChoices,
        }
      } else if (parsedChunks.length > 0) {
        parsedBody = parsedChunks
      }
    } catch {}

    debugLog.addResponse(
      debugId,
      serviceId,
      {
        status: response.status,
        body: parsedBody,
        providerMetadata: nonEmpty(providerMetadata),
        stream: true,
      },
      startTime,
    )
  } catch (err) {
    logReadFailure(response, entry, err)
  }
}
