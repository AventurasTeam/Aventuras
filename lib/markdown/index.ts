import { parseMarkdownToHtml } from './parse'
import { sanitizeHtml } from './sanitize'

export function renderNarrativeHtml(markdown: string): string {
  return sanitizeHtml(parseMarkdownToHtml(markdown))
}

export { sanitizeHtml } from './sanitize'
export { detectRichEntryHtml } from './rich-detect'
export { sanitizeRichHtml } from './rich-sanitize'
export { parseMarkdownToHtml } from './parse'
export { createHtmlStreamBuffer, type HtmlStreamBuffer } from './stream-buffer'
