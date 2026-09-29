import { stripPicTags } from './inlineImageParser'

/** How one kind of markup is handled: `keep` leaves it, `unwrap` drops the markup and keeps its text, `remove` drops both. */
export interface NarrationCleanOptions {
  pic: 'keep' | 'remove'
  html: 'keep' | 'unwrap'
  /** `### …` lines. */
  headings: 'keep' | 'unwrap' | 'remove'
  /** Lines that are one `**…**` span end to end. */
  boldLines: 'keep' | 'unwrap' | 'remove'
  /** `***`, `---` and `___`. */
  rules: 'keep' | 'remove'
  /** `*italic*` and `**bold**` inside a sentence. */
  inlineEmphasis: 'keep' | 'unwrap'
}

export const CLEAN_NONE: NarrationCleanOptions = {
  pic: 'keep',
  html: 'keep',
  headings: 'keep',
  boldLines: 'keep',
  rules: 'keep',
  inlineEmphasis: 'keep',
}

export const CLEAN_FOR_REVIEW: NarrationCleanOptions = {
  pic: 'remove',
  html: 'unwrap',
  headings: 'remove',
  boldLines: 'remove',
  rules: 'remove',
  inlineEmphasis: 'keep',
}

/** Time and place live in the headings, and the classifier fills them. */
export const CLEAN_FOR_CLASSIFICATION: NarrationCleanOptions = {
  ...CLEAN_FOR_REVIEW,
  headings: 'unwrap',
  boldLines: 'unwrap',
}

/** A bold line longer than this, or ending like a sentence, is emphasis rather than a heading. */
const HEADING_MAX_WORDS = 8
const SENTENCE_END = /[.!?…"”]$/

// Only real element names: `<Kael>` in prose is text, not markup.
const HTML_TAGS =
  'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr'.replaceAll(
    ' ',
    '|',
  )

const ATTRIBUTES = String.raw`(?:"[^"]*"|'[^']*'|[^<>"'])*`
const BLOCK_SCRIPT = /<(style|script)\b[^<>]*>[\s\S]*?<\/\1\s*>/gi
const ITALIC_PAIR = new RegExp(String.raw`<(em|i)\b${ATTRIBUTES}>([\s\S]+?)<\/\1\s*>`, 'gi')
const BOLD_PAIR = new RegExp(String.raw`<(strong|b)\b${ATTRIBUTES}>([\s\S]+?)<\/\1\s*>`, 'gi')
const PARAGRAPH_END = /<\/(?:p|div|h[1-6])\s*>/gi
const LINE_BREAK = new RegExp(String.raw`<br\b${ATTRIBUTES}>|<\/li\s*>`, 'gi')
const KNOWN_TAG = new RegExp(String.raw`<\/?(?:${HTML_TAGS})\b${ATTRIBUTES}>`, 'gi')
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole
    const code =
      body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

function unwrapHtml(content: string): string {
  const withoutTags = content
    .replace(BLOCK_SCRIPT, '')
    .replace(ITALIC_PAIR, '*$2*')
    .replace(BOLD_PAIR, '**$2**')
    .replace(PARAGRAPH_END, '\n\n')
    .replace(LINE_BREAK, '\n')
    .replace(KNOWN_TAG, '')
  // Block markup leaves its source indentation behind; prose that had no tags keeps its own.
  const tidy = withoutTags === content ? withoutTags : withoutTags.replace(/^[ \t]+|[ \t]+$/gm, '')
  return decodeEntities(tidy)
}

function isHeading(text: string): boolean {
  return text.trim().split(/\s+/).length <= HEADING_MAX_WORDS && !SENTENCE_END.test(text.trim())
}

function cleanLayout(content: string, o: NarrationCleanOptions): string {
  let text = content
  if (o.rules === 'remove') {
    text = text.replace(/^[ \t]*([*\-_])(?:[ \t]*\1){2,}[ \t]*(?:\r?\n|$)/gm, '')
  }
  if (o.headings === 'unwrap') text = text.replace(/^#{1,6}[ \t]+(.*)$/gm, '$1')
  else if (o.headings === 'remove') text = text.replace(/^#{1,6}[ \t]+.*(?:\r?\n|$)/gm, '')
  if (o.boldLines !== 'keep') {
    // One span covering the whole line, so a line carrying two of them keeps both intact.
    text = text.replace(
      /^[ \t]*\*\*((?:(?!\*\*).)+)\*\*[ \t]*(\r?\n|$)/gm,
      (_whole, inner: string, newline: string) =>
        o.boldLines === 'remove' && isHeading(inner) ? '' : inner + newline,
    )
  }
  return text
}

function unwrapInlineEmphasis(content: string): string {
  return content.replace(/\*\*(?=\S)([^*\n]*\S)\*\*/g, '$1').replace(/\*(?=\S)([^*\n]*\S)\*/g, '$1')
}

export function cleanNarration(content: string, options: NarrationCleanOptions): string {
  if (Object.values(options).every((mode) => mode === 'keep')) return content

  let text = content
  if (options.pic === 'remove') text = stripPicTags(text)
  if (options.html === 'unwrap') text = unwrapHtml(text)
  text = cleanLayout(text, options)
  if (options.inlineEmphasis === 'unwrap') text = unwrapInlineEmphasis(text)
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export function narrationCleaner(options: NarrationCleanOptions): (content: string) => string {
  return (content) => cleanNarration(content, options)
}
