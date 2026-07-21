import { parseMarkdownToHtml } from './parse'
import { sanitizeDocumentHtml, sanitizeHtml } from './sanitize'

export function renderNarrativeHtml(markdown: string): string {
  return sanitizeHtml(parseMarkdownToHtml(markdown))
}

// Link-preserving variant for surfaces with their own anchor interception
// (model-card document); narrative entries stay on the anchor-free path.
export function renderDocumentHtml(markdown: string): string {
  return sanitizeDocumentHtml(parseMarkdownToHtml(markdown))
}

export { sanitizeHtml } from './sanitize'
export { detectRichEntryHtml } from './rich-detect'
export { sanitizeRichHtml } from './rich-sanitize'
export { parseMarkdownToHtml } from './parse'
export { createHtmlStreamBuffer, type HtmlStreamBuffer } from './stream-buffer'
