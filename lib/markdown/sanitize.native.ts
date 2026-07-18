// The web sanitize step exists for dangerouslySetInnerHTML: juice inlines
// <style> blocks and DOMPurify strips executable content. Neither tool runs
// under Metro's native resolution (both reach Node builtins via jsdom), and
// neither threat applies: react-native-render-html has no script execution
// and ignores <style>/<script> tags, and its inline-style translation covers
// only the RN style subset (no url()-bearing properties). Passthrough keeps
// native renders identical to what RenderHTML would extract from the
// sanitized document anyway.
export function sanitizeHtml(html: string): string {
  return html
}
