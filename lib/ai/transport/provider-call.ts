import { generateText, streamText } from 'ai'

type GenerateTextOptions = Parameters<typeof generateText>[0]
type StreamTextOptions = Parameters<typeof streamText>[0]

export function runProviderCall(opts: GenerateTextOptions): ReturnType<typeof generateText> {
  return generateText({ ...opts, maxRetries: 0 } as GenerateTextOptions)
}

export function streamProviderCall(opts: StreamTextOptions): ReturnType<typeof streamText> {
  return streamText({ ...opts, maxRetries: 0 } as StreamTextOptions)
}
