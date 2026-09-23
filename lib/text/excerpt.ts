/** A one-line preview: whitespace collapsed, cut at a word boundary, code-point safe. */
export function excerpt(text: string | null | undefined, maxChars = 120): string | undefined {
  if (text == null) return undefined
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return undefined
  // Array.from splits code points, not UTF-16 units — slicing could sever an emoji surrogate pair.
  const chars = Array.from(collapsed)
  if (chars.length <= maxChars) return collapsed
  const cut = chars.slice(0, maxChars).join('')
  if (chars[maxChars] === ' ') return `${cut}…`
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`
}
