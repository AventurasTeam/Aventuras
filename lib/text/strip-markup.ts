// A block or tag with no close runs to the end: a SQL window can cut one off mid-way.
const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g
const TAG = /<\/?[a-z][^>]*(?:>|$)/gi

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
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? match
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
  const withoutHtml = source.replace(STYLE_OR_SCRIPT, ' ').replace(COMMENT, ' ').replace(TAG, ' ')
  const withoutMarkdown = withoutHtml
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:```|~~~).*$/gm, '')
    .replace(/^(?=.*-{3})[\s|:-]+$/gm, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
    .replace(/\*(\S(?:[^*]*?\S)?)\*/g, '$1')
    .replace(/(^|\W)_(\S(?:[^_]*?\S)?)_(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\|/g, ' ')
  return decodeEntities(withoutMarkdown)
}
