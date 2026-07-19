// Resolution stub: entry HTML renders only inside web documents (the reader
// document on native, the page itself on desktop web), so nothing in the
// native bundle calls this. It exists so the module root resolves under
// Metro's native platform without pulling web-only DOM dependencies.
export function sanitizeHtml(html: string): string {
  return html
}
