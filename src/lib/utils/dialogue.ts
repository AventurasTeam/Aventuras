/**
 * Dialogue detection — the single definition of "this text is a spoken line".
 *
 * Two features read this module and they must never disagree: the story renderer
 * colours dialogue (a `marked` inline extension, see `markdown.ts`) and the TTS
 * pipeline speaks it in a second voice (see `TTSService.ts`). Written as two
 * different regexes, the two would drift apart at the first edge case — so both
 * go through `matchDialogueAt`.
 *
 * The rules, deliberately small:
 *
 * - Three quote pairs: straight, typographic, and guillemets. Guillemets are not
 *   decoration: narration translated into Italian or French comes back with them.
 * - Single quotes are NOT dialogue. `don't`, `l'uomo` and English possessives make
 *   them unusable without a part-of-speech model.
 * - A dialogue span never crosses a blank line. On the renderer side marked's
 *   inline lexer already works per block so this is free; on the TTS side there is
 *   no block structure at all, and without this rule one unterminated quote would
 *   swallow half a scene into the wrong voice.
 * - An unterminated quote is not dialogue. During streaming that means a line stays
 *   neutral until its closing quote arrives, rather than flickering.
 */

/** Opening/closing character for each recognised quote style. */
const QUOTE_PAIRS: ReadonlyArray<readonly [open: string, close: string]> = [
  ['"', '"'],
  ['“', '”'], // “ ”
  ['«', '»'], // « »
]

const OPENERS = QUOTE_PAIRS.map(([open]) => open)

export interface DialogueMatch {
  /** The full matched text, quotes included. */
  raw: string
  /** The text between the quotes. */
  inner: string
  /** The opening quote character. */
  open: string
  /** The closing quote character. */
  close: string
}

export interface DialogueSegment {
  text: string
  isDialogue: boolean
}

/**
 * True when the newline at `index` starts a blank line (paragraph break).
 * A single newline does not count: with `breaks: true` it is a `<br>` inside the
 * same paragraph, and a quote may legitimately span it.
 */
function isParagraphBreak(text: string, index: number): boolean {
  for (let i = index + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') return true
    if (ch !== ' ' && ch !== '\t' && ch !== '\r') return false
  }
  return false
}

/**
 * Try to read a dialogue span starting exactly at `index`.
 * Returns null when there is no opening quote there, when it is never closed
 * within the paragraph, or when the quotes hold nothing but whitespace.
 */
export function matchDialogueAt(text: string, index = 0): DialogueMatch | null {
  const open = text[index]
  const pair = QUOTE_PAIRS.find(([o]) => o === open)
  if (!pair) return null

  const close = pair[1]

  for (let i = index + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n' && isParagraphBreak(text, i)) return null
    if (ch !== close) continue

    const inner = text.slice(index + 1, i)
    if (!/\S/.test(inner)) return null

    return { raw: text.slice(index, i + 1), inner, open, close }
  }

  return null
}

/**
 * Index of the next character that could open a dialogue span, or -1.
 * Used as `marked`'s extension `start()` so the text tokenizer stops just before
 * a candidate instead of swallowing it.
 */
export function findDialogueStart(text: string): number {
  let best = -1
  for (const opener of OPENERS) {
    const index = text.indexOf(opener)
    if (index !== -1 && (best === -1 || index < best)) best = index
  }
  return best
}

/**
 * Split text into alternating narrator/dialogue segments.
 *
 * Lossless: `segmentDialogue(t).map((s) => s.text).join('') === t`. Whitespace-only
 * narrator segments are therefore emitted rather than dropped — trimming is the
 * caller's job, because dropping them here would make the concatenation invariant
 * false and hide the loss from the tests that pin it.
 */
export function segmentDialogue(text: string): DialogueSegment[] {
  if (!text) return []

  const segments: DialogueSegment[] = []
  let narrator = ''
  let i = 0

  const flushNarrator = () => {
    if (narrator) {
      segments.push({ text: narrator, isDialogue: false })
      narrator = ''
    }
  }

  while (i < text.length) {
    const match = matchDialogueAt(text, i)
    if (match) {
      flushNarrator()
      segments.push({ text: match.raw, isDialogue: true })
      i += match.raw.length
    } else {
      narrator += text[i]
      i++
    }
  }

  flushNarrator()
  return segments
}
