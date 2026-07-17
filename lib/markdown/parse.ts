import { marked } from 'marked'

marked.use({ gfm: true, breaks: true })

export function parseMarkdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false })
}
