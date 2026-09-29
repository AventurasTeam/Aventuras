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

// `marked`'s inline `tag` rule: the only `<` it passes through as HTML. Anything else it escapes.
const ATTRIBUTE = String.raw`\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?`
const WELL_FORMED_MARKUP = [
  String.raw`<!--(?:-?>|[\s\S]*?-->)`,
  String.raw`<\/[a-zA-Z][\w:-]*\s*>`,
  String.raw`<[a-zA-Z][\w-]*(?:${ATTRIBUTE})*\s*\/?>`,
  String.raw`<\?[\s\S]*?\?>`,
  String.raw`<![a-zA-Z]+\s[\s\S]*?>`,
  String.raw`<!\[CDATA\[[\s\S]*?\]\]>`,
].join('|')
const MARKUP_OR_ANGLE = new RegExp(`(?:${WELL_FORMED_MARKUP})|<`, 'g')

const BLOCK_ELEMENTS = new Set(
  'p div h1 h2 h3 h4 h5 h6 blockquote ul ol table pre section article header footer aside nav main figure dl details summary hr'.split(
    ' ',
  ),
)
const LINE_ELEMENTS = new Set(['li', 'tr', 'dt', 'dd'])
const CELL_ELEMENTS = new Set(['td', 'th'])
const HIDDEN_ELEMENTS = new Set(['style', 'script'])

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/** Escapes each `<` that does not begin a well-formed tag, so the parser sees what `marked` lets through. */
export function escapeStrayAngles(content: string): string {
  return content.replace(MARKUP_OR_ANGLE, (match) => (match === '<' ? '&lt;' : match))
}

function childrenText(node: Node): string {
  let text = ''
  for (const child of node.childNodes) text += textOf(child)
  return text
}

function emphasis(inner: string, marker: string): string {
  const body = inner.trim()
  if (!body) return inner
  const start = inner.indexOf(body)
  return inner.slice(0, start) + marker + body + marker + inner.slice(start + body.length)
}

function textOf(node: Node): string {
  if (node.nodeType === TEXT_NODE) return (node.nodeValue ?? '').replaceAll(' ', ' ')
  if (node.nodeType !== ELEMENT_NODE) return ''

  const name = (node as Element).localName
  if (HIDDEN_ELEMENTS.has(name)) return ''
  if (name === 'br') return '\n'

  const inner = childrenText(node)
  if (name === 'em' || name === 'i') return emphasis(inner, '*')
  if (name === 'strong' || name === 'b') return emphasis(inner, '**')
  if (BLOCK_ELEMENTS.has(name)) return `\n\n${inner}\n\n`
  if (LINE_ELEMENTS.has(name)) return `${inner}\n`
  if (CELL_ELEMENTS.has(name)) return `${inner} `
  return inner
}

function unwrapHtml(content: string): string {
  if (!/[<&]/.test(content)) return content
  // A template's content is inert: no script runs and nothing loads.
  const template = document.createElement('template')
  template.innerHTML = escapeStrayAngles(content)
  const text = childrenText(template.content)
  // Block markup leaves its source indentation behind; prose that had no tags keeps its own.
  if (!template.content.querySelector('*')) return text
  return text.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '')
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
  return text.replace(/(?:\r?\n){3,}/g, '\n\n').trim()
}

export function narrationCleaner(options: NarrationCleanOptions): (content: string) => string {
  return (content) => cleanNarration(content, options)
}
