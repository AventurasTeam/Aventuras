# Failed Storybook files with zero failed tests

A full `pnpm test:run` can exit non-zero reporting failed test
_files_ while the test count is all-green — a handful of
browser-project files fail to _load_ with
`Failed to fetch dynamically imported module` or
`Cannot connect to the iframe …`. The failing set varies run to
run and the same files pass in isolation, so the run reads as
"something is broken, unclear what," and the residual gets argued
by hand. That is the shape that hides a real browser-project
regression.

## Why

**Not worker contention**, which is the intuitive read and the one
the original report assumed. Measured at `abc6b9d9` on a 32-core
machine — 432 files, 4318 tests:

| Condition                        | Result                    |
| -------------------------------- | ------------------------- |
| 10× warm repeat                  | green                     |
| Cold Vite dep-optimizer cache    | green                     |
| 28 CPU burners, 2.6× slower wall | green                     |
| `--maxWorkers=1` vs `=128`       | no effect at all          |
| `--fileParallelism=false`        | 3.6× slower, 1 test fails |

Starvation severe enough to more than double the wall clock should
trip a contention-driven flake and does not. Timeout headroom says
the same: under that starvation the slowest file takes 18s against
the 60s browser `connectTimeout`, with a 1.2s median.

Two of those rows also invalidate the remedy the report proposed
("concurrency limits on the browser project"):

- **`maxWorkers` is inert here.** Forcing 1 and forcing 128 produce
  the same wall clock to within 4%. Browser-mode parallelism does
  not resolve from it, so capping it changes nothing but the
  config's apparent intent.
- **`fileParallelism: false` is the knob that works, and it is
  harmful.** It takes the Storybook project from 26s to 96s, and it
  fails `app-actions-menu-pure.stories.tsx > Diagnostics On`
  reproducibly (2/2 runs) — a test that passes alone. Serializing
  puts every file in one page, so app-level DOM state (a leftover
  `data-density` on `<body>`) survives across files. Parallel
  execution is load-bearing for isolation, not just for speed.

The leading hypothesis for the original failures is instead a **404
on the addon's setup file**, which produces the first error string
exactly. A worktree that symlinks `node_modules` resolves that file
to its real path, outside the Vite root, where the browser cannot
fetch it — the case `server.fs.allow` in `vitest.config.ts` exists
to cover. That guard landed in `a867976b` (2026-08-18), after the
report. It stays a hypothesis: a blanket 404 should fail every file
deterministically, which does not explain the run-to-run variation
the report described.

## How to apply

- Treat `pnpm test:run` as the gate. Splitting the run and eyeballing
  the residual was a workaround for this flake, and it costs the
  signal it was meant to protect.
- Failed files with zero failed tests is an **infrastructure**
  signature, not a test signature. A real regression fails tests.
  Read the file-level error before assuming a product bug.
- If it returns, check `server.fs.allow` first, and check whether the
  checkout's `node_modules` is a symlink (`readlink node_modules`).
  Rerun the named files in isolation to confirm they load.
- Do not serialize the browser project to chase a flake. The table
  above is the measurement: it costs 3.6× wall clock and breaks an
  isolation assumption the suite currently relies on.
