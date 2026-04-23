# Aventuras — tech stack

Living inventory of what's installed, what's decided, and what's parked.
Prose, not a task tracker. Update entries as choices change; move items
between sections as state shifts.

---

## Currently installed

Foundation layer:

- **Mobile:** Expo SDK 55 + Expo Router 6 (TypeScript)
- **Desktop:** Electron 41 wrapping the Expo Web export
  - Custom `app://` protocol for asset loading in packaged builds
  - `ready-to-show` pattern to avoid first-paint layout glitches
  - Dev-mode CDP on `:9222` so `electron-mcp-server` can attach
- **Styling:** NativeWind v4 + Tailwind v3 + shadcn-style theme CSS variables (light + dark)
- **Components:** react-native-reusables in `components/ui/` — button, card, input, alert, dialog, text, icon
- **Storybook:** `@storybook/react-native-web-vite` framework + Vitest + Playwright story tests (20/20 passing)
- **Tooling:** ESLint 9 (flat) + Prettier + EditorConfig + lefthook pre-commit + `.nvmrc`
- **CI:** GitHub Actions workflow (lint, format:check, typecheck, electron:compile, story tests)
- **MCP:** electron-mcp-server + storybook-mcp wired in `.mcp.json`

---

## Decided, not yet installed

Items numbered in install order — each layer composes with the previous.

### 1. SQLite + Drizzle ORM

Local-first. All user config and data lives in SQLite. No env vars, no BaaS.

- `expo-sqlite` for the underlying driver (works on iOS, Android, and under Electron via the same adapter)
- `drizzle-orm` for TypeScript-first queries — schema as source of truth; types flow from schema definitions
- `drizzle-kit` for migrations generated from schema diffs

**Schema designed in full at [`docs/data-model.md`](./data-model.md).** Thirteen tables covering the narrative spine (stories, branches, story_entries, chapters), world-state (entities, lore, threads), the happenings fact-graph (happenings + involvements + awareness links), media (assets + entry_assets), and the append-only deltas log that powers rollback, branching, and CTRL-Z.

### 2. TanStack Query (React Query v5)

Wraps drizzle query functions with:

- Shared cache across components
- Automatic refetch/invalidation after mutations
- Loading/error states without boilerplate
- Optimistic updates when we need snappy UX

Pair pattern: a thin `db/*.ts` module exports typed data-access functions; `hooks/use-*.ts` wraps them with `useQuery` / `useMutation`. Components only touch the hooks.

**Alternative considered:** drizzle's own `useLiveQuery` hook — simpler mental model, but loses optimistic updates + cross-cutting cache invalidation. Revisit if React Query proves heavyweight for our access patterns.

### 3. Zustand

For **UI / client state only** — which screen is open, editor dirty flags, drag gesture state, toast queue, etc. Domain data stays in React Query's cache (which is backed by SQLite). Don't duplicate SQLite rows into Zustand stores.

Plan to use:

- Multiple small stores per feature area (`useEditor`, `usePlayback`, ...) rather than a single monolithic store
- Middleware: `persist` (for UI preferences like last-open-tab), `immer` (when state nests), `devtools` (for browser-extension time-travel)
- `useShallow` selector helper to avoid re-render cascades when components pick multiple fields

### 4. react-hook-form + zod

Standard "the first form we ship" pair:

- Zod schema doubles as runtime validation AND source of TypeScript types — one definition, both uses
- RHF for uncontrolled inputs → minimal re-renders
- Integration via `@hookform/resolvers/zod`

Defer until the first real form exists; no reason to install speculatively.

Note: Zod's role in this project is broader than forms — see **Zod (cross-cutting)** below.

### 5. Vercel AI SDK

Provider-agnostic LLM layer. Same shape as the old app — proven choice.

- `ai` for the core API + `@ai-sdk/anthropic` / `@ai-sdk/openai` / `@ai-sdk/google` per supported provider
- `generateObject({ schema: zodSchema })` for structured outputs when the provider supports them; fall back to `generateText` + `jsonrepair` + `zodSchema.parse()` otherwise
- `streamText` / `streamObject` for incremental rendering during AI replies
- Provider + model + API key are per-story settings (`stories.settings` in the data model), with keys persisted in SQLite per the local-first strategy

### 6. js-tiktoken

Token counting for the chapter-close threshold (default 24k per-story, configurable) and general context-budget accounting.

- Pure-JS, works on both RN-native (Expo) and RN-Web (Electron)
- Default encoding `cl100k_base` or `o200k_base` — approximates all modern LLMs well enough for threshold detection
- Load encoding tables on demand to keep base bundle size modest
- Accepted drift: the 24k threshold is a heuristic, so a few percent variance between OpenAI and Claude/Gemini tokenizers is irrelevant

### 7. jsonrepair

Fallback JSON parsing for LLM outputs that don't quite validate.

- Pattern: `JSON.parse()` first; on fail, run through `jsonrepair` and re-parse; then zod-validate
- Handles common LLM mistakes — trailing commas, missing/extra quotes, unclosed strings, Python-style `True`/`None`
- Tiny, MIT, actively maintained

### Zod (cross-cutting)

Zod schemas are the single source of truth for every data shape that crosses a boundary:

- **Form validation** (via `@hookform/resolvers/zod`, see item 4)
- **LLM structured outputs** — same schema flows into Vercel AI SDK's `generateObject`, translated to JSON Schema internally, then validates the parsed result on the way back
- **Runtime validation at system boundaries** — SQLite row parsing, user-imported JSON (story export/import), external API responses
- Types flow automatically to TypeScript via `z.infer<typeof schema>` — one schema, every use

The virtue is that the classifier's output shape lives in exactly one file and drives prompting, parsing, validation, and typing.

### 8. Prompt templates + editor (LiquidJS + CodeMirror 6)

**Templating engine:** LiquidJS. Safe-by-default (no eval), readable syntax, familiar to anyone who's touched Shopify/Jekyll. Same reasoning as many AI platform template systems.

**Editor UI — per-platform by design, not parity:**

- **RN Web / Electron:** CodeMirror 6 with a Liquid language mode and autocomplete sourced from the variable set each prompt's context exposes
- **Expo native:** plain monospace `TextInput` — no syntax highlighting, no autocomplete

Mobile/touch UX doesn't serve prompt authoring well; tablets would benefit but don't earn the build complexity for v1. If demand arises later, a toggleable "advanced editor" mode backed by `react-native-webview` + CM6 can be added as an opt-in setting without disturbing the default.

**Packs** themselves (the set of templates + metadata + runtime variable definitions bundled into a campaign/system kit) are a separate concern — deferred until the first classifier/agent actually needs templates. The editor above is the UI layer; packs are the data layer it edits.

### 9. Markdown rendering + HTML sanitization

LLM replies arrive as markdown with inline HTML. Unified pipeline, platform-specific render tails.

```
markdown + inline HTML string
  → marked / markdown-it       (md → HTML)
  → juice                      (inline <style> blocks into element style attrs)
  → DOMPurify                  (tight allowlist sanitization)
  → sanitized HTML string
```

- **RN Web / Electron:** `dangerouslySetInnerHTML` on a themed container — native browser rendering, exact CSS fidelity
- **Expo native:** `react-native-render-html`, with custom renderers for deprecated tags (`<font>`) and themed `tagsStyles` keyed to the NativeWind color tokens

**Expected fidelity:** ~80-90% between platforms for typical LLM output. The `juice` pre-pass closes the biggest gap (inline `<style>` blocks don't cascade on native by default). Complex layout CSS may render approximately; iterate on specific divergences as they surface.

**Streaming rendering:** port the `htmlStreaming` pattern from the old app (`src/lib/utils/htmlStreaming.ts` / `htmlSanitize.ts`). Buffer mid-stream chunks until tag boundaries, sanitize the completed fragment, then append — prevents half-tags reaching either renderer.

### 10. Spellcheck + grammar (Harper, tiered)

Tiered assistance: heavy where authoring happens, free native elsewhere.

- **harper.js** (Rust/WASM, offline) on the **narrative response composer** only — the surface where the user is actively composing prose that goes to the AI. Full lint + suggestions UI. User-toggleable in settings for those who find it too opinionated on creative writing
- **Platform-native spellcheck** (`spellCheck={true}`) on all other multiline prose surfaces — entity descriptions, lore bodies, chapter title/summary overrides, etc. Free dotted-underline + system suggestions via iOS / Android / Electron-browser native behavior; no runtime cost
- **Spellcheck explicitly OFF** (`spellCheck={false}`) on code-like surfaces — Liquid prompt editor, template fields, slug/ID inputs — to avoid false positives on template syntax

Same surface scope as the old app (narrative composer was the only place it showed) — we explored expanding it but Harper's UI weight doesn't justify painting every multiline input with underlines and suggestion popovers. Native spellcheck is the right dose outside the composer.

**Status:** deferred install until the narrative composer is built. No speculative dependencies.

---

## Deferred

Not pursued yet; revisit when the surrounding feature lands or a specific need arises.

- App icon + splash screen (replace Expo placeholders)
- Custom fonts via `expo-font`
- Error tracking (Sentry or similar)
- Chromatic tokens for visual regression (addon is already installed)
- Dependabot / Renovate for auto-dep-updates
- `SECURITY.md` and PR templates for when the repo goes public

---

## Known issues and pins

- **`lucide-react-native` pinned to `^0.577.0`** because v1.x shipped a broken `./context.js` export. Revisit when v1 lands a fix — we only use named icon imports, so a re-bump should be safe.
- **ESLint pinned to `^9.x`** because `eslint-plugin-react` (transitive via `eslint-config-expo`) doesn't yet support ESLint 10's new rule-context API. Revisit after eslint-plugin-react publishes compat.
- **Vite deprecation warning** on `esbuild` / `esbuildOptions` fields in `.storybook/main.ts` — Vite 8 renamed these. Cosmetic; will update when the Storybook preset catches up.
- **`vite-tsconfig-paths` deprecation notice** from Vitest — Vite 8 now resolves tsconfig paths natively. Something in Storybook's chain still pulls the old plugin; harmless until it goes away upstream.
- **README** is still the Expo default template copy. Low priority until there's actually a product to describe.
