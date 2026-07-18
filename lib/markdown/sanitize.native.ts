// The explicit client build: cheerio-only, no Node builtins (Metro's android
// resolution ignores the package's `browser` main field and would pull the
// fs-dependent Node entry).
import juice from 'juice/client'

// Native keeps the juice step so <style> blocks a provider emits inline into style=""
// attributes react-native-render-html can translate; without it stylesheet
// styling silently disappears on Android while web renders it. DOMPurify is
// skipped: it needs a DOM, and its threats don't apply — RNRH executes no
// scripts, ignores <script>, and its style translation covers only the RN
// style subset (no url()-bearing properties).
export function sanitizeHtml(html: string): string {
  try {
    return juice(html)
  } catch {
    // Malformed provider CSS must degrade to unstyled content, not a crash.
    return html
  }
}
