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
 * - An HTML tag is skipped whole, so a quote in one of its attributes can never
 *   close a span that opened in prose. Raw HTML *inside* a quote still renders as
 *   HTML; it is only the attribute quotes that stop being candidates.
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
 * Index just past the `>` of the HTML tag starting at `index`, or -1 when what is
 * there is not a tag.
 *
 * A quote may open in prose and the next quote in the text may belong to an
 * attribute — `He said "hi <span class="a">`. Scanning blindly closes the span on
 * that attribute quote, which splits the tag down the middle: the renderer then
 * escapes half of it into text and the other half becomes a stray end tag, and on
 * the streaming path a `<pic prompt="…">` mangled this way is no longer recognised,
 * so its image is lost. The tokenizer's immunity to attribute quotes only ever
 * covered the *opening* one — the extension runs before marked's `tag` tokenizer,
 * so nothing else stops the closing one.
 *
 * Tags are skipped rather than treated as a hard stop, because raw HTML inside a
 * quote is legitimate and rendered as such (`"<b>x</b>"`). Attribute values are
 * tracked so a `>` inside one does not end the tag early.
 */
function skipTag(text: string, index: number): number {
  if (text[index] !== '<') return -1
  const after = text[index + 1]
  if (!after || !/[a-zA-Z/!?]/.test(after)) return -1

  let quote: string | null = null
  for (let i = index + 1; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    // An unclosed tag is not a tag: fall back to reading the text literally.
    if (ch === '\n' && isParagraphBreak(text, i)) return -1
    if (ch === '>') return i + 1
  }

  return -1
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

    if (ch === '<') {
      const past = skipTag(text, i)
      // -1 leaves i alone, so a literal `<` is still ordinary text.
      if (past !== -1) {
        i = past - 1
        continue
      }
    }

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

export interface DialogueSpan {
  /** Index of the opening quote. */
  start: number
  /** Index just past the closing quote. */
  end: number
}

/**
 * Character ranges of every dialogue span in the text.
 *
 * Used by the image pipeline to keep an embedded-image marker from cutting a quote
 * in half — half a quote is an unterminated one, which by the rules above is not
 * dialogue at all, so the line would silently lose its colour.
 *
 * Tags are stepped over whole. `matchDialogueAt` refuses to *close* a span on an
 * attribute quote, but a scanner that tries every index would happily *open* one
 * there: `class="x"` is a well-formed pair read on its own. The renderer never meets
 * this because marked's `tag` tokenizer consumes the tag first — the scanners have no
 * such thing in front of them, so they need the rule spelled out.
 */
export function dialogueSpans(text: string): DialogueSpan[] {
  const spans: DialogueSpan[] = []
  let i = 0

  while (i < text.length) {
    const pastTag = text[i] === '<' ? skipTag(text, i) : -1
    if (pastTag !== -1) {
      i = pastTag
      continue
    }

    const match = matchDialogueAt(text, i)
    if (match) {
      spans.push({ start: i, end: i + match.raw.length })
      i += match.raw.length
    } else {
      i++
    }
  }

  return spans
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
    // Stepped over for the same reason as in `dialogueSpans`, and kept in the
    // narrator run so the concatenation invariant still holds.
    const pastTag = text[i] === '<' ? skipTag(text, i) : -1
    if (pastTag !== -1) {
      narrator += text.slice(i, pastTag)
      i = pastTag
      continue
    }

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
