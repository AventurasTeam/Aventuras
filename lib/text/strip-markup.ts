const ATTRIBUTES = String.raw`(?:\s+[a-zA-Z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?)*?\s*`

// marked's raw-HTML grammar: anything short of a complete tag or comment renders as literal text.
// One left-to-right scan, so whichever construct opens first owns the text it spans.
const HTML = new RegExp(
  [
    // A code span shows its tags as text; it is kept here and unwrapped with the markdown.
    '(`[^`]+`)',
    String.raw`<!--(?:-?>|[\s\S]*?-->)`,
    // An unclosed comment opening a line starts an HTML block, which the browser hides to the end.
    String.raw`^ {0,3}<!--(?![\s\S]*?-->)[\s\S]*`,
    // The browser reads an unclosed style or script as raw text to the end (not `$`: flag m).
    String.raw`<(style|script)${ATTRIBUTES}\/?>[\s\S]*?(?:<\/\2\s*>|(?![\s\S]))`,
    String.raw`<([a-zA-Z][\w-]*)${ATTRIBUTES}\/?>`,
    String.raw`<\/([a-zA-Z][\w:-]*)\s*>`,
  ].join('|'),
  'gim',
)

const INLINE_TAGS = new Set(
  'a abbr b cite code del dfn em font i ins kbd mark s small span strike strong sub sup u var wbr'.split(
    ' ',
  ),
)

// Hidden content and inline tags leave no gap; any other tag is a break (unknown ones included).
function replaceHtml(
  _match: string,
  code?: string,
  _hidden?: string,
  open?: string,
  close?: string,
): string {
  if (code != null) return code
  const name = open ?? close
  return name != null && !INLINE_TAGS.has(name.toLowerCase()) ? ' ' : ''
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] !== '#') {
      // Own keys only: `&constructor;` would otherwise resolve to Object.prototype's.
      const key = name.toLowerCase()
      return Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : match
    }
    const code =
      name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

/**
 * Readable text of an entry body (markdown with inline HTML, stored raw) for a preview line.
 * Not a sanitizer: its output only ever reaches plain `Text`.
 */
export function stripMarkup(source: string): string {
  const withoutHtml = source.replace(HTML, replaceHtml)
  const withoutMarkdown = withoutHtml
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:```|~~~).*$/gm, '')
    .replace(/^(?=.*-{3})[\s|:-]+$/gm, '')
    // Ordered-list numbers stay: the reader shows them, where a bullet is only a dot.
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)/gm, '')
    .replace(/(\*\*|__|~~)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
    .replace(/\*(\S(?:[^*]*?\S)?)\*/g, '$1')
    .replace(/(^|\W)_(\S(?:[^_]*?\S)?)_(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\|/g, ' ')
  return decodeEntities(withoutMarkdown)
}
