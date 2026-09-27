# Dev environment

How the development servers and the desktop dev app find their ports
and data, and how several checkouts share one machine. The E2E suite
is not covered here: it binds dynamic ports and seeds its own temp
`userData` (see [testing.md](./testing.md#launch-modes)), so it needs
none of this.

## Dev slots

Every dev tool used to bind fixed ports, and the desktop dev app always
opened `~/.config/aventuras-dev`. That is fine for one checkout and
breaks for two: the second Metro fails to bind, and the second dev app
hits the single-instance lock or opens a DB whose migrations belong to
another branch. A **dev slot** is a numbered set of ports plus a
`userData` dir, one per checkout, so parallel worktrees (agent workers)
each get their own.

Slots are **off unless a machine opts in** through
`AVENTURAS_DEV_SLOT`:

| Value      | Effect                                                    |
| ---------- | --------------------------------------------------------- |
| unset / "" | Slot 0: the ports and `userData` the tooling always used. |
| `auto`     | The worktree claims a slot from 1 to 9 and keeps it.      |
| `0`-`9`    | That slot, with no claim. For manual use.                 |

Leaving it unset keeps a developer machine unchanged: every worktree
shares slot 0 and the one dev DB, as before.

### What a slot owns

| Resource          | Slot 0                    | Slot N                                                |
| ----------------- | ------------------------- | ----------------------------------------------------- |
| Metro             | 8081                      | 8081 + N                                              |
| Electron DevTools | 9222                      | 9230 + N                                              |
| Storybook         | 6006                      | 6006 + N                                              |
| Mock LLM          | 4319                      | 4319 + N                                              |
| `userData`        | `~/.config/aventuras-dev` | `~/.config/aventuras-dev-slotN`                       |
| Android           | the attached device       | AVD `Aventuras_Slot_N`, serial `emulator-<5552 + 2N>` |

The DevTools port is what the `electron-app` MCP server attaches to:
`.mcp.json` points it at `AVENTURAS_DEVTOOLS_PORT`, defaulting to 9222,
so each worker's agent drives its own app. A tool that discovers apps
by scanning ports instead cannot do that — `electron-mcp-server`, which
this replaced, drove the first app it found, so a worker would have
clicked through another worker's app.

### Claiming

Under `auto`, a worktree claims the lowest free slot the first time
any slot-aware command runs, and records it in
`<git-common-dir>/aventuras-dev-slots/`, shared by every worktree of
the clone. The claim is keyed on the worktree path, so it survives
restarts. A slot whose worktree has been removed, or deleted without
git, is free again, and handing it over **wipes its `userData`**: the
last branch's DB may carry migrations the next one does not know.
Slot data is disposable; `pnpm db:seed` refills it.

`pnpm dev:slot` claims and prints the slot (`--json` for a machine
reading). It also writes `.env.dev-slot.local` in the worktree
(gitignored), which exports `AVENTURAS_DEVTOOLS_PORT`,
`AVENTURAS_STORYBOOK_PORT` and, for worker slots, `ANDROID_SERIAL`.
The repo's own scripts never read that file — they resolve the slot
from the worktree path — it exists for tools that only read the
environment: the `storybook-mcp` URL in `.mcp.json`, and `adb`.

### Slot-aware commands

- **`pnpm desktop`** — Expo web on the slot's Metro port and Electron
  loading it. A worker slot also passes its DevTools port and
  `userData`, and skips the detached DevTools window.
- **`pnpm start` / `pnpm web`** — Metro on the slot's port.
- **`pnpm dev:android`** — Metro on the slot's port, reusing one that
  `pnpm desktop` already runs there, so one debug APK serves every
  slot. Slot 0 reverses `8081` to the attached device (or
  `ANDROID_SERIAL` when several are attached), as before. A worker
  slot boots its own AVD headless (software rendering) when it is not
  running, reverses its Metro port, and stops the app to point it
  there through React Native's `debug_http_host` dev setting. The
  reverse alone is not enough on an emulator: the debug build asks
  `10.0.2.2:8081`, the host's loopback, which `adb reverse` never
  sees. The APK must already be installed.
- **`pnpm storybook`** — the slot's Storybook port.
- **`pnpm mock`** — the slot's mock LLM port, unless `--port` or
  `MOCK_LLM_PORT` says otherwise.
- **`pnpm db:seed`** — seeds the slot's DB, and in a worker slot points
  the seeded provider at the slot's mock LLM. An explicit path or
  `AVENTURAS_DB_PATH` bypasses the slot, which is how the E2E harness
  calls it.

Paths assume Linux, like the `db:seed` default always has.

### Setting up a worker machine

1. Set `AVENTURAS_DEV_SLOT=auto` in the environment agents run
   under, such as the service that hosts them.
2. Run `pnpm dev:slot` in the worktree setup hook, after
   `pnpm install`, so the env file exists before an agent's shell
   starts.
3. Source `.env.dev-slot.local` from the shell's startup file when the
   shell starts inside a worktree.
4. Create one AVD per slot you expect to use, named
   `Aventuras_Slot_N`.
