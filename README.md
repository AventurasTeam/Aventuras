# Aventuras

An AI-collaborative writing app. You write fiction with
an AI co-author against backed by an advanced memory system
that ensures characters, locations, items, factions, lore, plot
threads, and event history are all tracked as the story
unfolds. Branch the narrative freely. Roll back any change. All
data lives on your machine.

Cross-platform via a single Expo app: mobile (iOS / Android)
through Expo Go, desktop (Linux / macOS / Windows) through
Electron wrapping the web build. No accounts, no cloud, no
environment variables; everything in local database file.

> **Note on history.** The previous iteration of this project
> lives on the `legacy/master` branch. The `main` branch is a
> ground-up rewrite taking lessons learned. Same idea, different architecture.
> Old issues, branches, and history remain reachable via
> `legacy/master`.

## Status

**Pre-implementation.** The project is in the design + foundation
phase:

- Domain, schema, architecture, and UI surfaces are
  comprehensively specified in [`docs/`](./docs/README.md).
- Tooling is wired (Expo, Electron, Storybook, ESLint, Prettier,
  remark, lefthook, Vitest, Playwright story tests, CI).
- A handful of design-system primitives have been scaffolded
  (`components/ui/*` with Storybook stories).
- The writing-app domain itself, stories, entries, the
  classifier pipeline, world-state retrieval, the AI collaborator,
  has not yet been built.

This README describes the project's intent. Documentation
describes the design. Code-following-design lands incrementally.

## Documentation

The substance of the project today is the design corpus. Start
here:

- **[`docs/README.md`](./docs/README.md)** index of all
  documentation.
- **[`docs/architecture.md`](./docs/architecture.md)**
  pipeline, generation context, retrieval, translation. How the
  code will be organized.
- **[`docs/data-model.md`](./docs/data-model.md)** schema
  decisions: stories, branches, entries, entities, lore, threads,
  happenings, chapters, delta log.
- **[`docs/ui/`](./docs/ui/README.md)** UI design: principles,
  cross-cutting patterns, and per-screen wireframes (interactive
  HTML + companion `.md` rationale per surface).
- **[`docs/tech-stack.md`](./docs/tech-stack.md)** full stack
  with rationale.
- **[`docs/followups.md`](./docs/followups.md)** open design
  questions (current milestone).
- **[`docs/explorations/`](./docs/explorations/README.md)**
  dated session records of design decisions.

## Stack

- **Runtime**: Expo SDK 55, React 19, React Native 0.83, React
  Native Web, Electron 41.
- **Styling**: NativeWind 4 + Tailwind 3 with shadcn-style theme
  CSS variables.
- **Storage**: `expo-sqlite` (local-first; no backend).
- **Build / dev**: pnpm 10, Node 24, Vite (via Storybook), TypeScript.
- **Quality**: ESLint 9, Prettier 3, remark (doc lint), lefthook
  (pre-commit hooks), Vitest + Playwright (story tests).

Full rationale in [`docs/tech-stack.md`](./docs/tech-stack.md).

## Repository layout

```
.
├── app/                Expo Router routes (mobile + web)
├── electron/           Electron main + preload (desktop shell)
├── components/         Shared UI components (RN + RN Web)
│   └── ui/             Design-system primitives + Storybook stories
├── lib/ hooks/ types/ constants/
├── docs/               Project documentation (the canonical spec)
│   ├── ui/             UI principles, patterns, per-screen designs
│   ├── explorations/   Dated design-session records
│   └── followups.md / parked.md
├── scripts/            Repository scripts
├── .storybook/         Storybook config
├── .github/            CI workflows
└── .claude/            Claude-Code-specific tooling (rules, skills)
```

## Development

Requires Node 24 and pnpm 10 (both pinned via `.nvmrc` and
`packageManager`).

```sh
pnpm install
```

### Doc tooling

```sh
pnpm lint:docs       # remark over docs/
```

Wireframes are static HTML colocated with each screen's `.md`
under `docs/ui/screens/<screen>/`. Open the `.html` directly in a
browser.

### Storybook (design-system primitives)

```sh
pnpm storybook       # http://localhost:6006
```

Runs the active design-system catalog. Stories under
`components/ui/*.stories.tsx`.

### Web / mobile (Expo)

```sh
pnpm web             # web build via Expo
pnpm android         # Android emulator
pnpm ios             # iOS simulator
```

The app shell is currently the default Expo scaffold, domain
implementation hasn't started. These commands work but won't show
the writing app itself.

### Desktop (Electron)

```sh
pnpm desktop         # web build + Electron, hot-reloaded
```

### Quality

```sh
pnpm lint            # ESLint
pnpm format:check    # Prettier
pnpm typecheck       # tsc --noEmit
pnpm test            # Vitest watch
pnpm test:run        # Vitest single-run + Playwright story tests
```

CI runs all of the above on every push / PR.

## Workflow

- **Pre-commit hooks** (`lefthook.yml`) run prettier + eslint +
  remark in parallel on staged files. Don't bypass with
  `--no-verify`.
- **Commits** are small and focused. Multiple commits beat a
  single omnibus commit when the work is logically separable.
- **File moves** use `git mv` to preserve history; inbound
  references update in the same commit.

Project-specific Claude-Code rules live under
[`.claude/`](./.claude/) (skills + topic-scoped rules that
auto-load when relevant files are read).
