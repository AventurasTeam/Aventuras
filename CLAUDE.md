# Aventuras

Local-first cross-platform AI-collaborative writing app. Mobile via
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
- [`docs/architecture.md`](./docs/architecture.md) — pipeline,
  state, retrieval, translation.
- [`docs/ui/`](./docs/ui/README.md) — UI design (principles +
  per-screen wireframes & docs).
- [`docs/followups.md`](./docs/followups.md) — outstanding
  cross-domain items.

## Repo layout

```
.
├── app/                   Expo Router routes
├── electron/              Electron main + IPC
├── components/            Shared UI (RN + RN Web)
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

Add new topic files (`code.md`, `testing.md`, etc.) when patterns
emerge in those domains.
