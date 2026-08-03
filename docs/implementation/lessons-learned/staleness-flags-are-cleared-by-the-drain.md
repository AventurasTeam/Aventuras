# Staleness flags are cleared by the drain, so a post-hoc assertion races it

Every writer that touches an embedded field sets `embedding_stale = 1`
and embeds nothing itself — the drain worker owns the vector. That makes
the flag a **handoff signal, not a durable property**: the drain picks
the row up moments later and resets it to `0`.

An E2E assertion written after the fact therefore tests the drain's
scheduling, not the writer's contract:

```ts
// Passes or fails depending on whether the drain has run yet.
const rows = await queryApp(
  page,
  `SELECT COUNT(*) FROM happenings WHERE branch_id = ? AND embedding_stale != 1`,
  [branchId],
)
expect(rows[0][0]).toBe(0)
```

The periodic-classifier smoke hit exactly this: with no embedder
installed the assertion passed (nothing drained), and installing a real
embedder to exercise disambiguation made the same assertion start
failing — for the right reason, on unchanged product code.

## How to apply

Assert the write-path contract where the write happens, not where the
row lands:

- **Unit / mock-LLM level** — the action or phase test observes the row
  before any drain exists, so `embedding_stale = 1` is stable there.
  That is the correct home for "nothing embeds on the write path".
- **E2E with a real embedder** — assert the _outcome_ instead: the vector
  exists, or the row is absent from the stale set once quiescent. Never
  assert the intermediate flag.

The general rule: a column that another worker is racing you to reset is
not an observable in a test that runs after both. Pick an assertion on
either the initial write or the settled end state — never the handoff.

## Why it generalises

`embedding_stale` is not the only such flag: any queue-and-drain pair in
the app (embedder swap progress, drain kick markers) has the same shape.
The tell is a column whose only writer-side value is "someone else needs
to look at this" — those are always transient by construction.
