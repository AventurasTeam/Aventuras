// Turns the text of a streamed (SSE) response into the one body the debug log shows.

export type StreamFormat =
  'anthropic' | 'openai-responses' | 'chat-completions' | 'gemini' | 'unknown'

interface SseMessage {
  event?: string
  data: string
}

export interface StreamEvent {
  payload: unknown
  /** The `[DONE]` sentinel, which carries no payload. */
  done?: boolean
}

export interface StreamSummary {
  format: StreamFormat
  body: unknown
  /** The format's final event arrived (or, for an unknown format, the body was read to its end). */
  complete: boolean
  eventCount: number
  error?: string
  /** The last payload received, for a stream that stopped before it completed. */
  lastEvent?: unknown
}

interface Aggregated {
  body: unknown
  complete: boolean
  error?: string
}

type JsonObject = Record<string, unknown>

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.message === 'string') return value.message
  return JSON.stringify(value)
}

/** Follows the SSE field rules: any line ending, comments, multi-line `data`, a last event with no blank line. */
export function parseSse(text: string): SseMessage[] {
  const messages: SseMessage[] = []
  let event: string | undefined
  let data: string[] = []

  const dispatch = () => {
    if (data.length > 0) messages.push({ event, data: data.join('\n') })
    event = undefined
    data = []
  }

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === '') {
      dispatch()
      continue
    }
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  dispatch()
  return messages
}

export function parseStreamEvents(text: string): StreamEvent[] {
  return parseSse(text).map(({ data }): StreamEvent => {
    if (data === '[DONE]') return { payload: undefined, done: true }
    try {
      return { payload: JSON.parse(data) }
    } catch {
      return { payload: data }
    }
  })
}

function detectFormat(payloads: unknown[]): StreamFormat {
  for (const payload of payloads) {
    if (!isRecord(payload)) continue
    const type = typeof payload.type === 'string' ? payload.type : ''
    if (type.startsWith('message_') || type.startsWith('content_block_') || type === 'ping') {
      return 'anthropic'
    }
    if (type.startsWith('response.')) return 'openai-responses'
    if (Array.isArray(payload.choices)) return 'chat-completions'
    if ('candidates' in payload || 'promptFeedback' in payload || 'usageMetadata' in payload) {
      return 'gemini'
    }
  }
  return 'unknown'
}

function aggregateAnthropic(payloads: unknown[]): Aggregated {
  let message: JsonObject = {}
  const blocks = new Map<number, JsonObject>()
  const toolJson = new Map<number, string>()
  let complete = false
  let error: string | undefined

  for (const payload of payloads) {
    if (!isRecord(payload)) continue
    const index = typeof payload.index === 'number' ? payload.index : -1
    switch (payload.type) {
      case 'message_start':
        if (isRecord(payload.message)) message = { ...payload.message }
        break
      case 'content_block_start':
        if (isRecord(payload.content_block)) blocks.set(index, { ...payload.content_block })
        break
      case 'content_block_delta': {
        const block = blocks.get(index)
        const delta = payload.delta
        if (!block || !isRecord(delta)) break
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          block.text = `${String(block.text ?? '')}${delta.text}`
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          block.thinking = `${String(block.thinking ?? '')}${delta.thinking}`
        } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
          block.signature = delta.signature
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          toolJson.set(index, `${toolJson.get(index) ?? ''}${delta.partial_json}`)
        }
        break
      }
      case 'content_block_stop': {
        const block = blocks.get(index)
        const json = toolJson.get(index)
        if (!block || json === undefined) break
        toolJson.delete(index)
        try {
          block.input = json === '' ? {} : JSON.parse(json)
        } catch {
          block.partial_json = json
        }
        break
      }
      case 'message_delta':
        if (isRecord(payload.delta)) message = { ...message, ...payload.delta }
        if (isRecord(payload.usage)) {
          message.usage = { ...(isRecord(message.usage) ? message.usage : {}), ...payload.usage }
        }
        break
      case 'message_stop':
        complete = true
        break
      case 'error':
        error = errorMessage(payload.error)
        break
    }
  }

  // A tool call cut off mid-argument keeps the text that did arrive.
  for (const [index, json] of toolJson) {
    const block = blocks.get(index)
    if (block) block.partial_json = json
  }

  const content = [...blocks].toSorted(([a], [b]) => a - b).map(([, block]) => block)
  return { body: { ...message, content }, complete, error }
}

function aggregateResponses(payloads: unknown[]): Aggregated {
  let created: JsonObject | undefined
  let final: JsonObject | undefined
  let complete = false
  let error: string | undefined
  const items = new Map<number, JsonObject>()
  const texts = new Map<string, string>()
  const args = new Map<number, string>()

  for (const payload of payloads) {
    if (!isRecord(payload)) continue
    const outputIndex = typeof payload.output_index === 'number' ? payload.output_index : 0
    const contentIndex = typeof payload.content_index === 'number' ? payload.content_index : 0
    switch (payload.type) {
      case 'response.created':
      case 'response.in_progress':
        if (isRecord(payload.response)) created = payload.response
        break
      case 'response.output_item.added':
      case 'response.output_item.done':
        if (isRecord(payload.item)) items.set(outputIndex, { ...payload.item })
        break
      case 'response.output_text.delta':
        if (typeof payload.delta === 'string') {
          const key = `${outputIndex}:${contentIndex}`
          texts.set(key, `${texts.get(key) ?? ''}${payload.delta}`)
        }
        break
      case 'response.function_call_arguments.delta':
        if (typeof payload.delta === 'string') {
          args.set(outputIndex, `${args.get(outputIndex) ?? ''}${payload.delta}`)
        }
        break
      // A terminal event carries the whole response; `failed` and `incomplete` end the stream too.
      case 'response.completed':
      case 'response.incomplete':
        if (isRecord(payload.response)) final = payload.response
        complete = true
        break
      case 'response.failed':
        if (isRecord(payload.response)) {
          final = payload.response
          if (payload.response.error) error = errorMessage(payload.response.error)
        }
        complete = true
        break
      case 'error':
        error = errorMessage(payload)
        break
    }
  }

  if (final) return { body: final, complete, error }

  // Cut off before a terminal event: rebuild what the output items and text deltas gave.
  const output = [...items]
    .toSorted(([a], [b]) => a - b)
    .map(([index, item]) => {
      const argText = args.get(index)
      if (item.type === 'function_call' && argText !== undefined)
        return { ...item, arguments: argText }
      const text = texts.get(`${index}:0`)
      if (item.type === 'message' && text !== undefined && !Array.isArray(item.content)) {
        return { ...item, content: [{ type: 'output_text', text }] }
      }
      return item
    })
  return { body: { ...created, output }, complete, error }
}

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
    reasoning_content?: string
    tool_calls?: ToolCallDelta[]
  }
  finish_reason?: string | null
}

interface CompletionChunk {
  id?: string
  model?: string
  usage?: unknown
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
  return isRecord(value) && Array.isArray(value.choices)
}

function aggregateChat(payloads: unknown[], sawDone: boolean): Aggregated {
  const choices = new Map<number, AggregatedChoice>()
  let id = ''
  let model = ''
  let usage: unknown
  let error: string | undefined

  for (const chunk of payloads) {
    if (isRecord(chunk) && chunk.error) error = errorMessage(chunk.error)
    if (!isCompletionChunk(chunk)) continue
    if (chunk.id) id = chunk.id
    if (chunk.model) model = chunk.model
    if (chunk.usage) usage = chunk.usage

    for (const choice of chunk.choices) {
      let agg = choices.get(choice.index)
      if (!agg) {
        agg = {
          index: choice.index,
          message: { role: 'assistant', content: '' },
          finish_reason: null,
        }
        choices.set(choice.index, agg)
      }
      const delta = choice.delta ?? {}
      if (delta.role) agg.message.role = delta.role
      if (delta.content) agg.message.content += delta.content
      const reasoning = delta.reasoning ?? delta.reasoning_content
      if (reasoning) agg.message.reasoning = (agg.message.reasoning ?? '') + reasoning
      for (const tc of delta.tool_calls ?? []) {
        const toolCalls = (agg.message.tool_calls ??= [])
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
        if (typeof tc.function?.arguments === 'string') {
          aggTc.function.arguments += tc.function.arguments
        }
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        agg.finish_reason = choice.finish_reason
      }
    }
  }

  const finalChoices = [...choices.values()]
  for (const choice of finalChoices) {
    for (const tc of choice.message.tool_calls ?? []) {
      try {
        tc.function.parsed_arguments = JSON.parse(tc.function.arguments)
      } catch {
        // Cut-off or non-JSON arguments stay as the text that arrived.
      }
    }
  }

  const complete =
    sawDone || (finalChoices.length > 0 && finalChoices.every((c) => c.finish_reason !== null))
  return {
    body: { id, model, choices: finalChoices, ...(usage ? { usage } : {}) },
    complete,
    error,
  }
}

function aggregateGemini(payloads: unknown[]): Aggregated {
  let thought = ''
  let text = ''
  const calls: unknown[] = []
  let finishReason: unknown
  let safetyRatings: unknown
  let usageMetadata: unknown
  let modelVersion: unknown
  let responseId: unknown
  let promptFeedback: unknown
  let error: string | undefined

  for (const chunk of payloads) {
    if (!isRecord(chunk)) continue
    if (chunk.error) error = errorMessage(chunk.error)
    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata
    if (chunk.modelVersion) modelVersion = chunk.modelVersion
    if (chunk.responseId) responseId = chunk.responseId
    if (chunk.promptFeedback) promptFeedback = chunk.promptFeedback
    const candidate: unknown = Array.isArray(chunk.candidates) ? chunk.candidates[0] : undefined
    if (!isRecord(candidate)) continue
    if (candidate.finishReason) finishReason = candidate.finishReason
    if (candidate.safetyRatings) safetyRatings = candidate.safetyRatings
    const parts: unknown = isRecord(candidate.content) ? candidate.content.parts : undefined
    for (const part of Array.isArray(parts) ? (parts as unknown[]) : []) {
      if (!isRecord(part)) continue
      if (typeof part.text === 'string') {
        if (part.thought === true) thought += part.text
        else text += part.text
      } else if (part.functionCall) {
        calls.push(part)
      }
    }
  }

  const parts = [
    ...(thought ? [{ text: thought, thought: true }] : []),
    ...(text ? [{ text }] : []),
    ...calls,
  ]
  const blocked = isRecord(promptFeedback) && Boolean(promptFeedback.blockReason)
  return {
    body: {
      responseId,
      modelVersion,
      candidates: [
        {
          content: { role: 'model', parts },
          ...(finishReason ? { finishReason } : {}),
          ...(safetyRatings ? { safetyRatings } : {}),
        },
      ],
      usageMetadata,
      ...(promptFeedback ? { promptFeedback } : {}),
    },
    complete: Boolean(finishReason) || blocked,
    error,
  }
}

function aggregateUnknown(payloads: unknown[], readFinished: boolean): Aggregated {
  const failed = payloads.find((p) => isRecord(p) && (p.type === 'error' || p.error))
  return {
    body: payloads,
    complete: readFinished,
    error: isRecord(failed) ? errorMessage(failed.error ?? failed) : undefined,
  }
}

/** `readFinished` is whether the body was read to its end; only an unknown format has no final event of its own. */
export function aggregateStream(events: StreamEvent[], readFinished: boolean): StreamSummary {
  const payloads = events.filter((e) => !e.done).map((e) => e.payload)
  const format = detectFormat(payloads)
  const aggregated =
    format === 'anthropic'
      ? aggregateAnthropic(payloads)
      : format === 'openai-responses'
        ? aggregateResponses(payloads)
        : format === 'chat-completions'
          ? aggregateChat(
              payloads,
              events.some((e) => e.done),
            )
          : format === 'gemini'
            ? aggregateGemini(payloads)
            : aggregateUnknown(payloads, readFinished)
  return {
    format,
    body: aggregated.body,
    complete: aggregated.complete,
    eventCount: events.length,
    error: aggregated.error,
    lastEvent: aggregated.complete ? undefined : payloads.at(-1),
  }
}
