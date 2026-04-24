# Aventuras — tech stack

Living inventory of what's installed, what's decided, and what's parked.
Update entries as choices change; move items between sections as state shifts.

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

### 2. Zustand

In-memory domain + UI state. The loaded-story bundle (story + branches + current branch's entries / entities / lore / threads / happenings + links / chapters / entry_assets) lives here, mirrored from SQLite on load. SQLite remains the source of truth; Zustand is the in-memory view components read from.

**Loading:** `loadStory(storyId, branchId)` pulls everything in one drizzle query (a single SQLite transaction), hydrates the store. Fast on local disk.

**Mutations flow uniformly through store actions.** Each narrative-state change is a Zustand action that (a) writes the row to SQLite + appends its delta, (b) updates the in-memory tree. Both channels stay in sync because there's one path. The delta log is the reconciliation primitive — if drift ever happens, deltas are how we detect and repair.

**Store layout:**

- `useStoryStore` — the loaded story bundle + mutation actions
- Small per-feature stores for UI-only state (`useEditor`, `useNavigation`, `useToasts`, ...) — dirty flags, selection, drag gestures, toast queue
- No monolithic global store

**Middleware:** `persist` for UI preferences (last-open-tab, theme), `immer` for nested updates, `devtools` for time-travel debugging, `useShallow` selector to avoid re-render cascades when components pick multiple fields.

**Non-React access:** `useStoryStore.getState()` makes loaded data available to utility functions and delta handlers outside the React tree — no `queryClient.getQueryData()` dance.

### 3. react-hook-form

Standard form library:

- Uncontrolled inputs → minimal re-renders
- Paired with Zod (item 4) via `@hookform/resolvers/zod` for validation

Defer until the first real form exists; no reason to install speculatively.

### 4. Zod

Schema library; single source of truth for every data shape that crosses a boundary:

- **Form validation** — paired with react-hook-form (item 3); Zod schemas double as runtime validation AND TypeScript types (one definition, both uses)
- **LLM structured outputs** — same schemas flow into Vercel AI SDK's `generateObject` (item 5), translated to JSON Schema internally, then validate the parsed result on the way back
- **Runtime validation at system boundaries** — SQLite row parsing, user-imported JSON (story export/import), external API responses
- Types flow automatically to TypeScript via `z.infer<typeof schema>` — one schema, every use

The virtue is that the classifier's output shape lives in exactly one file and drives prompting, parsing, validation, and typing.

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

**Install:** when the narrative composer is built. No speculative dependencies.

---

## Deferred

Items considered and parked. Revisit when a specific need arises.

### TanStack Query (React Query)

Considered and not adopted. For this app's access patterns, RQ's value doesn't land:

- No network cache to manage — SQLite reads are local and fast, nothing to go stale
- External calls (LLM, image generation, TTS) are one-shot operations that persist artifacts, not cacheable reads — and Vercel AI SDK's own hooks handle streaming state
- Zustand covers the "loaded data" role (see item 2)

Reconsider if cross-device sync lands (below) — polling a remote source for deltas is one genuine RQ-shaped use case. Even then, install locally within the sync module rather than app-wide.

### Cross-device sync via Google Drive

Optional feature: sync a user's stories + assets to their own Google Drive via the Drive REST API (BYO-OAuth, no server we operate). Matches the local-first ethos — user owns their data on their own cloud storage.

**Architectural fit is good:** the delta log is inherently sync-friendly. Deltas are UUID-identified, append-only, and already represent any narrative state change. Assets are content-addressed by sha256, so binary sync can dedupe naturally.

**Conflict handling hook:** if two devices both write after the last sync, the divergence maps cleanly to our branching mechanic — treat each device's post-sync work as a branch from the last common point, let the user merge or keep both.

Status: unexplored. Revisit post-MVP once the core writing loop is solid.

### Pre-launch polish

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
