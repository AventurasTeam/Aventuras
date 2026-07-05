import DOMPurify from 'dompurify'
import juice from 'juice'

const ALLOWED_TAGS = [
  'p',
  'em',
  'strong',
  'blockquote',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'br',
  'hr',
  'a',
  'span',
]
const ALLOWED_ATTR = ['href', 'class']

export function sanitizeHtml(html: string): string {
  const inlined = juice(html)
  return DOMPurify.sanitize(inlined, { ALLOWED_TAGS, ALLOWED_ATTR })
}
