// Resolution stub: entry HTML renders only inside web documents (the reader
// document on native, the page itself on desktop web), which Metro bundles as
// web and which therefore resolve the real ./sanitize. Throwing rather than
// passing the markup through keeps a future Hermes caller from silently
// emitting unsanitized HTML — mirrors ./rich-sanitize.native.ts.
export function sanitizeHtml(html: string): string {
  void html
  throw new Error('sanitizeHtml is web-bundle-only; native sanitizes inside the DOM component')
}

export function sanitizeDocumentHtml(html: string): string {
  void html
  throw new Error(
    'sanitizeDocumentHtml is web-bundle-only; native sanitizes inside the DOM component',
  )
}
