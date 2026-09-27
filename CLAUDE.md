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
- [`docs/code-conventions.md`](./docs/code-conventions.md) — code
  conventions: module structure, state placement, action layer,
  component taxonomy, i18n, unit/component testing, forms, pnpm.
- [`docs/testing.md`](./docs/testing.md) — the E2E layer:
  Playwright/Electron harness, fixture/seed contract, mock LLM,
  selector strategy; when a slice warrants an E2E test.
- [`docs/dev-environment.md`](./docs/dev-environment.md) — dev slots:
  per-worktree ports and `userData` for parallel workers on one
  machine.
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

### electron-app

Playwright MCP (`@playwright/mcp`) attached over CDP to the running
desktop dev app — the smoke check at the end of a slice. It drives the
app by accessibility snapshot, the same role-and-name approach the E2E
suite uses. Common tools:

- `browser_tabs` — list and select pages
- `browser_snapshot` — ARIA tree with element refs to act on
- `browser_click` / `browser_type` / `browser_fill_form` — act on refs
- `browser_take_screenshot` — saved under `.playwright-mcp/` or
  elsewhere in the workspace, never outside it
- `browser_evaluate` / `browser_console_messages` — renderer state

Requires `pnpm desktop` to be running first. It attaches to
`AVENTURAS_DEVTOOLS_PORT` (default 9222), so in a worker dev slot it
reaches that slot's app only (see
[`docs/dev-environment.md`](./docs/dev-environment.md#what-a-slot-owns)).
**On slot 0 the detached DevTools window is the first tab**: run
`browser_tabs` and select the `Aventuras` tab before snapshotting or
clicking. Worker slots open no DevTools window.

### storybook-mcp

Component-aware MCP for the Storybook design system, exposed at
`http://localhost:6006/mcp` by `@storybook/addon-mcp` (the slot's
Storybook port in a worker dev slot).

**The Storybook dev server MUST be running before the session
starts.** Claude Code connects to this server at startup, retries a
refused connection only briefly, then marks it failed, and the session
has no storybook-mcp tools at all. Start it in a separate terminal
first:

```sh
pnpm storybook
```

If Storybook came up after the session started, reconnect the server
from `/mcp`. An unattended worker can't do that, so it goes without
this server unless Storybook was already running when it launched.

## Workflow rules

- **Node version**: develop on the `.nvmrc` version (Node 24.x), which
  `engines.node` and `engine-strict` enforce. Node 25+ shifts eslint's
  `import/order` resolution and fails `pnpm lint` on files CI passes on
  Node 24 — so if lint fails locally but CI is green, check `node -v`
  first.
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

[`.claude/rules/`](./.claude/rules/) holds rules that apply to **all
agents** working on this repo. Claude Code auto-loads them based on
the `paths` frontmatter when matching files are read.

**Other agents (Codex, Cursor, etc.) and human contributors must
read the applicable file at the start of any code or doc task.**
Auto-load is Claude-only; the rules themselves are universal. This
file is symlinked from `AGENTS.md`, so non-Claude agents that read
`AGENTS.md` land here.

- [`docs.md`](./.claude/rules/docs.md) — documentation conventions
  (anchor-link discipline, heading stability, followups hygiene,
  wireframe template, doc-tooling). Applies to any `docs/**` or
  `.claude/rules/**` work.
- [`code.md`](./.claude/rules/code.md) — source-edit rules
  (commenting discipline, import-wildcard ban with rn-primitives
  exception). Applies to any `app/**`, `components/**`, `hooks/**`,
  `lib/**`, `types/**`, `electron/**`, or `scripts/**` work.
- [`testing.md`](./.claude/rules/testing.md) — test-layer rules
  (which layer to use, desktop-only E2E, fixture/seed contract,
  DB-first selectors). Applies to any `e2e/**`, `*.spec.ts`, or
  `*.test.{ts,tsx}` work.

Code work also draws on
[`docs/implementation/lessons-learned/`](./docs/implementation/lessons-learned/README.md)
— indexed implementation pitfalls and runtime gotchas. Check the
index before touching the substrate an entry references.

Add new topic files (`testing.md`, etc.) when patterns emerge in
those domains.
