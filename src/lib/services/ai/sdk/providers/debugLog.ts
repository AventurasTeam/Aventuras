// AI-specific debug logging for the SDK transports: Gemini safety metadata and the stream summary.
// The generic request/response helpers live in `#lib/services/http`.

import {
  createResponseLogger,
  describeReadFailure,
  parseLoggedBody,
  readLoggedBody,
  type DebugEntry,
} from '#lib/services/http/index.ts'
import { debugLog } from '#lib/stores/debugLog.ts'
import { aggregateStream, parseStreamEvents } from './streamLog'

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

export async function logStreamResponse(response: Response, entry: DebugEntry): Promise<void> {
  const { debugId, serviceId, startTime } = entry
  const read = await readLoggedBody(response)
  const events = parseStreamEvents(read.text)
  const summary = aggregateStream(events, read.ok)

  const providerMetadata: ProviderMetadata = {}
  for (const { payload } of events) Object.assign(providerMetadata, providerMetadataOf(payload))
  const safety = nonEmpty(providerMetadata)

  const error = !read.ok
    ? describeReadFailure(read)
    : (summary.error ?? (summary.complete ? undefined : 'stream ended before its final event'))

  debugLog.addResponse(
    debugId,
    serviceId,
    {
      status: response.status,
      ...(error && { error }),
      body: events.length === 0 ? parseLoggedBody(read.text) : summary.body,
      stream: {
        format: summary.format,
        complete: summary.complete,
        eventCount: summary.eventCount,
        ...(summary.error && { error: summary.error }),
      },
      ...(summary.lastEvent !== undefined && { lastEvent: summary.lastEvent }),
      ...(safety && { providerMetadata: safety }),
    },
    startTime,
    error,
  )
}
