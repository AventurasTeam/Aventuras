import type { ServerResponse } from 'node:http'

import { contentFrame, roleFrame, stopFrames } from './wire'

export type StreamPacing = {
  /** 0 delivers the whole reply in a single frame. */
  charsPerSecond: number
  chunkSize: number
  jitterMs: number
}

export type StreamOptions = StreamPacing & {
  content: string
  /** Stop partway and close the socket without a stop frame or [DONE]. */
  cut?: boolean
  aborted: () => boolean
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Splits on word boundaries rather than at a fixed character offset: a stream
 * chopped mid-word renders visibly differently in the reader than a real
 * provider's token stream, which is the thing being eyeballed.
 */
export function chunkContent(content: string, chunkSize: number): string[] {
  if (content.length === 0) return []
  const pieces = content.match(/\s*\S+|\s+/g) ?? [content]
  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    current += piece
    if (current.length >= chunkSize) {
      chunks.push(current)
      current = ''
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function jittered(ms: number, jitterMs: number): number {
  if (jitterMs <= 0) return ms
  return Math.max(0, ms + (Math.random() * 2 - 1) * jitterMs)
}

// res.write returns false once the socket buffer is full; ignoring it lets a
// slow client build an unbounded backlog instead of pacing to its own speed.
function write(res: ServerResponse, frame: string): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(frame)) resolve()
    else res.once('drain', resolve)
  })
}

/** Emits the SSE body. Headers must already be written by the caller. */
export async function streamNarrative(res: ServerResponse, opts: StreamOptions): Promise<void> {
  await write(res, roleFrame())
  if (opts.aborted()) return

  if (opts.charsPerSecond <= 0 && opts.cut !== true) {
    await write(res, contentFrame(opts.content))
    if (!opts.aborted()) res.end(stopFrames())
    return
  }

  const chunks = chunkContent(opts.content, opts.chunkSize)
  const emit =
    opts.cut === true ? chunks.slice(0, Math.max(1, Math.floor(chunks.length / 2))) : chunks

  for (const chunk of emit) {
    if (opts.aborted()) return
    if (opts.charsPerSecond > 0) {
      await sleep(jittered((chunk.length / opts.charsPerSecond) * 1000, opts.jitterMs))
      if (opts.aborted()) return
    }
    await write(res, contentFrame(chunk))
  }

  if (opts.aborted()) return
  // The cut path closes without a stop frame or [DONE] on purpose: that is the
  // truncated-stream failure the app has to survive.
  if (opts.cut === true) res.end()
  else res.end(stopFrames())
}
