import { APICallError, generateText, streamText, type LanguageModel } from 'ai'

import { ProviderTimeoutError } from './classify-provider-error'

type TimeoutConfig = { totalMs?: number; stepMs?: number; chunkMs?: number }

type ProviderCallOpts = {
  prompt: string
  signal: AbortSignal
  timeout: TimeoutConfig
}

function mapCallError(error: unknown, signal: AbortSignal): never {
  // APICallError carries an HTTP status → let classifyProviderError map it.
  if (APICallError.isInstance(error)) throw error
  // A user cancel aborts the caller's signal; anything else with no user abort
  // is the SDK's internal timeout firing → retryable provider timeout.
  if (!signal.aborted) throw new ProviderTimeoutError()
  throw error
}

export async function runProviderCall(
  model: LanguageModel,
  opts: ProviderCallOpts,
): Promise<string> {
  try {
    const { text } = await generateText({
      model,
      prompt: opts.prompt,
      abortSignal: opts.signal,
      maxRetries: 0,
      timeout: opts.timeout,
    })
    return text
  } catch (error) {
    mapCallError(error, opts.signal)
  }
}

export function streamProviderCall(
  model: LanguageModel,
  opts: ProviderCallOpts,
): ReturnType<typeof streamText> {
  return streamText({
    model,
    prompt: opts.prompt,
    abortSignal: opts.signal,
    maxRetries: 0,
    timeout: opts.timeout,
  })
}
