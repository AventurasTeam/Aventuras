# Aventuras — technical roadmap

Living notes on the stack and what's planned. Prose, not a task tracker.
Delete sections as they land; add sections as decisions solidify.

---

## Shipped

Foundation we've already set up:

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

## Tier 2 — next up (feature-adjacent)

Order below is the sensible install order: each step composes with the previous.

### 1. SQLite + Drizzle ORM

**Decision:** Local-first app. All user config and data lives in SQLite. **No env vars, no BaaS.**

- `expo-sqlite` for the underlying driver (works on iOS, Android, and under Electron via the same adapter)
- `drizzle-orm` for TypeScript-first queries — schema as source of truth; types flow from schema definitions
- `drizzle-kit` for migrations generated from schema diffs

**Status: deferred — needs a dedicated data-shape session first.**

Aventuras is an AI-assisted story-writing app with this rough domain shape:

- **Story** — top-level container
- **Entries** — individual text pieces making up a story, generally alternating user/AI messages
- **Checkpoints** — a _flag_ on an entry, marking a snapshot of "world state" at that point (not every entry is one)
- **Branches** — divergent continuations that fork from a checkpoint (not an arbitrary entry)

"World state" implies more than text — likely characters / lore / plot state
captured alongside each checkpoint. Shape TBD. There's a prior version of
this app that already shipped these concepts; schema will lean on that.

**Open questions to resolve in the design session:**

- Concrete schema for a checkpoint's world-state payload (typed columns? JSON blob? separate side tables per kind of state?)
- Whether entries are immutable once written, or can be edited post-hoc
- Rollback semantics — which entries actually get deleted, and how branches that depend on them are handled
- Schema migration strategy on first app boot vs. on user action
- Backup / export format for user data (JSON dump? `.sqlite` file? both?)

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

---

## Tier 3 — parked for pre-launch

Low priority until we're nearing a real release:

- App icon + splash screen (replace Expo placeholders)
- Custom fonts via `expo-font`
- Error tracking (Sentry or similar)
- Chromatic tokens for visual regression (addon is already installed)
- Dependabot / Renovate for auto-dep-updates
- `SECURITY.md` and PR templates for when the repo goes public

---

## Known open threads

- **`lucide-react-native` pinned to `^0.577.0`** because v1.x shipped a broken `./context.js` export. Revisit when v1 lands a fix — we only use named icon imports, so a re-bump should be safe.
- **ESLint pinned to `^9.x`** because `eslint-plugin-react` (transitive via `eslint-config-expo`) doesn't yet support ESLint 10's new rule-context API. Revisit after eslint-plugin-react publishes compat.
- **Vite deprecation warning** on `esbuild` / `esbuildOptions` fields in `.storybook/main.ts` — Vite 8 renamed these. Cosmetic; will update when the Storybook preset catches up.
- **`vite-tsconfig-paths` deprecation notice** from Vitest — Vite 8 now resolves tsconfig paths natively. Something in Storybook's chain still pulls the old plugin; harmless until it goes away upstream.
- **README** is still the Expo default template copy. Low priority until there's actually a product to describe.
