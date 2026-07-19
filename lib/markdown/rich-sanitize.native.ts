// postcss reaches for Node builtins Metro's native resolution won't stub
// (lessons-learned: metro-native-ignores-browser-builds). Native rich entries
// sanitize inside the DOM component, which Metro bundles as a web bundle and
// which therefore resolves the real ./rich-sanitize implementation.
export function sanitizeRichHtml(html: string): string {
  void html
  throw new Error('sanitizeRichHtml is web-bundle-only; native sanitizes inside the DOM component')
}
