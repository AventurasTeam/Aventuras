import { Tiktoken } from 'js-tiktoken/lite'
import o200kBase from 'js-tiktoken/ranks/o200k_base'

// Every provider is an estimate, so o200k tracks the modern vocab scale (ASCII prose about 1% under
// cl100k, CJK about 30% lower). BPE map build (200k entries): ~285 ms desktop, ~1 s Android
// emulator. The 2.2 MB rank table is a static import: countTokens must stay sync for the pure
// ranker.
let encoder: Tiktoken | null = null

/** The vocabulary behind countTokens, frozen for the probe capture (lib/db → CaptureTokenizer). */
export const TOKENIZER_IDENTITY = { encoding: 'o200k_base', version: '1' } as const

function getEncoder(): Tiktoken {
  encoder ??= new Tiktoken(o200kBase)
  return encoder
}

/** Builds the encoder ahead of the first count; a no-op once it exists. */
export function warmTokenEncoder(): void {
  getEncoder()
}

// js-tiktoken's merge is quadratic in one regex word, and o200k takes a run of non-whitespace, of
// whitespace, or of newlines and slashes after punctuation as one. Cutting all three caps a word
// at 1,025 code points, so the merge stays linear; each cut moves the count by a few tokens. The
// lookbehinds spare the scan a retry at every position in a run, except after `/` or a newline,
// where the last alternative can stop partway through one.
const LONGEST_ENCODED_RUN = 512
const LONG_RUN = new RegExp(
  `(?<![^\\s/])\\S{${LONGEST_ENCODED_RUN + 1},}|(?<![^\\S\\r\\n])\\s{${LONGEST_ENCODED_RUN + 1},}|[\\r\\n/]{${LONGEST_ENCODED_RUN + 1},}`,
  'gu',
)
const RUN_PIECE = new RegExp(`[\\s\\S]{1,${LONGEST_ENCODED_RUN}}`, 'gu')

function encodedLength(text: string): number {
  // Empty allow/disallow lists: tiktoken special-token literals (e.g.
  // "<|endoftext|>") can appear in ordinary user/LLM prose here, and the
  // default "disallowedSpecial: all" throws instead of counting them.
  return getEncoder().encode(text, [], []).length
}

export function countTokens(text: string): number {
  if (text === '') return 0
  let tokens = 0
  let encodedTo = 0
  for (const match of text.matchAll(LONG_RUN)) {
    if (match.index > encodedTo) tokens += encodedLength(text.slice(encodedTo, match.index))
    for (const [piece] of match[0].matchAll(RUN_PIECE)) tokens += encodedLength(piece)
    encodedTo = match.index + match[0].length
  }
  if (encodedTo < text.length) tokens += encodedLength(text.slice(encodedTo))
  return tokens
}
