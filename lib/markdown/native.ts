import {
  defaultHTMLElementModels,
  type HTMLElementModelRecord,
  type MixedStyleRecord,
} from 'react-native-render-html'

// Keyed to the same NativeWind tokens the web allowlist renders through
// (docs/tech-stack.md -> Markdown rendering + HTML sanitization).
export const narrativeTagsStyles: MixedStyleRecord = {
  p: { marginVertical: 4 },
  blockquote: { borderLeftWidth: 2, paddingLeft: 8, fontStyle: 'italic' },
  code: { fontFamily: 'monospace' },
  em: { fontStyle: 'italic' },
  strong: { fontWeight: '700' },
}

// `<font>` is deprecated HTML some providers still emit. react-native-render-html
// has no built-in element model for it, so on its own the engine treats it as an
// unknown tag; borrowing `span`'s (phrasing/inline) model keeps its children
// rendering as normal text instead of the node being dropped.
export const narrativeCustomHTMLElementModels: HTMLElementModelRecord = {
  font: defaultHTMLElementModels.span,
}
