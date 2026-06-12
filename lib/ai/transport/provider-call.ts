import { generateText, streamText } from 'ai'

type GenerateTextOptions = Parameters<typeof generateText>[0]
type StreamTextOptions = Parameters<typeof streamText>[0]

// callWithRetry is the sole retry authority, so the SDK must never retry on its
// own — these proxies force that one default over the full SDK call surface
// (`opts` is the SDK's own options type, carrying its `timeout` and `output`
// schema, so nothing is re-declared here) and are otherwise pass-through. Error
// classification stays in classifyProviderError. The assertion bridges a TS
// limit: spreading collapses the options' `prompt | messages` discriminant.
export function runProviderCall(opts: GenerateTextOptions): ReturnType<typeof generateText> {
  return generateText({ ...opts, maxRetries: 0 } as GenerateTextOptions)
}

export function streamProviderCall(opts: StreamTextOptions): ReturnType<typeof streamText> {
  return streamText({ ...opts, maxRetries: 0 } as StreamTextOptions)
}
