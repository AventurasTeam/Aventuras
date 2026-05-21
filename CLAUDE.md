# Aventuras

Cross-platform AI-collaborative writing app. Mobile via
Expo, desktop via Electron. Single Expo app shared across platforms;
Electron wraps the web build. Domain core: Stories → branches →
entries + entities + lore + threads + happenings (with awareness
links) + chapters + delta log. All data + config in SQLite — no env
vars, no BaaS.

## Authoritative reading

- [`docs/README.md`](./docs/README.md) — project documentation index
  and doc-structure rules.
- [`docs/tech-stack.md`](./docs/tech-stack.md) — full stack +
  rationale.
- [`docs/data-model.md`](./docs/data-model.md) — schema + decisions.
- [`docs/architecture.md`](./docs/architecture.md) — prompt
  templates and authoring, settings, agent orchestration overview,
  translation, retrieval invariants.
- [`docs/generation-pipeline.md`](./docs/generation-pipeline.md) —
  pipeline framework: phases, orchestrator, action layer, event bus,
  transactions, concurrency model.
- [`docs/memory/`](./docs/memory/README.md) — memory pipeline:
  cadence layers, piggyback + classifier + chapter-close contracts,
  retrieval (embeddings, queries, ranker, pinning, budgets), edge
  cases, schema delta + followups.
- [`docs/ui/`](./docs/ui/README.md) — UI design (principles +
  per-screen wireframes & docs).
- [`docs/followups.md`](./docs/followups.md) — active outstanding
  items (current milestone).
- [`docs/parked.md`](./docs/parked.md) — items deferred beyond v1
  (post-v1 confirmed + parked-until-signal).

## Repo layout

```
.
├── app/                   Expo Router routes
├── electron/              Electron main + IPC
├── components/            Shared UI (RN + RN Web)
│   ├── ui/                Primitives (single semantic role)
│   ├── compounds/         Compounds — peer compositions of primitives
│   ├── <domain>/          Domain compounds (entity, story, reader, ...)
│   ├── shells/            Layout shells (top-level screen routes)
│   └── foundations/       Storybook-only docs surfaces
├── lib/ hooks/ types/ constants/
├── assets/                Static assets bundled with the app
├── docs/                  Project documentation
├── scripts/               Repo scripts
├── .claude/
│   └── rules/             Topic-scoped Claude rules
│                          (auto-load on matching file reads)
├── .github/               CI / actions
└── .storybook/            Storybook config
```

Component-folder taxonomy + decision rule:
[`components/README.md`](./components/README.md) (quick reference)
and [`docs/ui/components.md → Directory layout`](./docs/ui/components.md#directory-layout)
(canonical).

## Stack at a glance

Expo SDK 55 + Electron 41 + RN Web + NativeWind 4 + Tailwind 3 +
shadcn-style theme CSS vars. React 19, RN 0.83. Storybook
(react-native-web-vite). ESLint 9 + Prettier 3 + lefthook + remark.
pnpm 10. Vitest. Full details in
[`docs/tech-stack.md`](./docs/tech-stack.md).

## MCP tools

Two project MCP servers are configured in
[`.mcp.json`](./.mcp.json):

### electron-mcp-server

Inspects and controls the Electron window during development. Useful
for debugging desktop-specific behavior, capturing screenshots of the
running app, and reading main-process logs.

Available tools:

- `get_electron_window_info` — window state, dimensions, URL
- `read_electron_logs` — main-process console output
- `send_command_to_electron` — invoke commands in the renderer
- `take_screenshot` — capture the running window

Spawns automatically via `npx` on tool invocation. Requires the
desktop app to be running (`pnpm desktop`); otherwise window-targeted
tools have nothing to attach to.

### storybook-mcp

Component-aware MCP for the Storybook design system, exposed at
`http://localhost:6006/mcp` by `@storybook/addon-mcp`.

**The Storybook dev server MUST be running first.** Without it, every
MCP tool call fails with a connection error. Start it in a separate
terminal before using any storybook-mcp tool:

```sh
pnpm storybook
```

If a tool call returns a connection / fetch error, the most likely
cause is the server isn't running yet — start it and retry.

## Workflow rules

- **Pre-commit hooks (`lefthook.yml`)** run prettier, eslint, and
  remark in parallel on staged files. Don't bypass with
  `--no-verify` — fix the underlying issue.
- **Commits**: prefer multiple focused commits over one omnibus
  commit when work is logically separable. Never amend committed
  work; create a new commit instead.
- **Commit messages**: subject ≤ 72 chars. Body optional and
  ≤ 6 lines when present — the `commit-msg` hook counts blank
  separators and the `Co-Authored-By` trailer toward the limit.
  Answer _why_; name what the diff doesn't show. Length matches
  substance — `chore:` / `fix:` commits rarely need a body.

  **Don't include**: diff restatement ("Updates X's prose about
  Y…"), adversarial-pass enumerations, drift-pass / pre-commit-hook
  fix lists, substrate or inventory sections that re-summarize the
  doc being committed, mini-changelogs of sub-followups created.
  These are process artifacts or duplicate the diff, the
  exploration record, or [`followups.md`](./docs/followups.md).

  **Do include** when relevant: resolved followup by name, the key
  contract/architectural decision in one paragraph, new sub-followups
  (one line each), pointer to the exploration record.

- **File moves**: use `git mv` to preserve history. Update inbound
  references in the same commit.

## Topic-scoped rules

[`.claude/rules/`](./.claude/rules/) holds rules that auto-load when
Claude reads files matching their `paths` frontmatter. Keeps general
context lean; topic-specific rules surface contextually.

- [`docs.md`](./.claude/rules/docs.md) — documentation conventions
  (anchor-link discipline, heading stability, followups hygiene,
  wireframe template, doc-tooling). Loads on `docs/**` or
  `.claude/rules/**` reads.
- [`code.md`](./.claude/rules/code.md) — source-edit rules
  (commenting discipline, import-wildcard ban with rn-primitives
  exception). Loads on `app/**`, `components/**`, `hooks/**`,
  `lib/**`, `types/**`, `electron/**`, or `scripts/**` reads.

Add new topic files (`testing.md`, etc.) when patterns emerge in
those domains.
