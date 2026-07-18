# Raw HTML islands need an explicit theme baseline

Content that renders outside RN `<Text>` — a web
`dangerouslySetInnerHTML` div, native `react-native-render-html`, a
future DOM component — gets **no color** from the component system.
On web it inherits from `body`; on native, RenderHTML falls back to
its own default. Neither baseline was theme-aware, so every such
island rendered default-black on dark themes. The bug recurred
per-island (entry content, reasoning blocks) because each fix
patched the island instead of the baseline.

## Why

- RN-Web styling flows through `<Text>` classes and
  `TextClassContext` (see
  [TextClassContext + bare strings](./textclasscontext-bare-strings.md)).
  Raw DOM nodes bypass all of it and fall through to CSS
  inheritance, which bottoms out at the UA default.
- Native `RenderHTML` has no inheritance chain to the app theme at
  all — color must arrive via `baseStyle`.

## How to apply

Both baselines are now theme-wired — **don't add per-island color
patches**:

1. **Web**: `global.css` `@layer base` sets
   `body { color: var(--fg-primary) }`. Theme vars live on
   `documentElement` (`data-theme`), so this resolves for every
   theme and covers every current and future raw-DOM island by
   inheritance.
2. **Native**: always pass `baseStyle` with an explicit theme color
   to `RenderHTML` (see `NarrativeContent` in
   `components/compounds/entry-card.tsx`). A variant that only sets
   color conditionally (e.g. muted-only) silently reintroduces the
   bug for the unconditional path.
3. New islands (e.g. rich-entry DOM components) must verify their
   inheritance chain reaches a theme-wired baseline — DOM components
   render in a separate document and need the tokens bridged in.
