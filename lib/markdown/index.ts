import { parseMarkdownToHtml } from './parse'
import { sanitizeHtml } from './sanitize'

export function renderNarrativeHtml(markdown: string): string {
  return sanitizeHtml(parseMarkdownToHtml(markdown))
}

export { sanitizeHtml } from './sanitize'
export { parseMarkdownToHtml } from './parse'
export { createHtmlStreamBuffer, type HtmlStreamBuffer } from './stream-buffer'
export { narrativeTagsStyles, narrativeCustomHTMLElementModels } from './native'
