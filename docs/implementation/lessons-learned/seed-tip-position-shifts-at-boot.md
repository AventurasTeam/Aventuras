# The seeded branch tip moves at boot, so a pre-launch position is not the app's

The dev fixture leaves the hero branch on a **dangling in-flight turn** — a
`user_action` whose reply never committed, plus its `pipeline_runs` marker.
`runBootstrap` calls `recoverInFlightRuns` before hydrate, which reverse-replays
that orphan away. The row is gone by the time the reader paints, and its
`position` is handed to the next turn the spec commits.

Every seed helper in `e2e/harness/seed.ts` runs against the DB **file, before
launch**. So a helper that reads `MAX(position)` reads a tip the app will not
boot with:

```ts
// Returns 72. After boot recovery the real tip is 71, and the spec's own
// first user_action lands ON 72 — below the watermark this just parked.
const tip = db
  .prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM story_entries WHERE branch_id = ?`)
  .get(branchId).p
```

The failure is silent and looks like a product bug. Parking the classifier
watermark one position high pushed the spec's first turn out of the pass window,
so `unprocessedTurnCount` saw three rows where the cadence needed four and the
pass simply never fired — no error, just a poll that timed out on an empty
`happenings` table. Had the count still reached the cadence, the damage would
have been worse: the window's `t1..tN` handles shift by one, so a fixture
anchoring a fact to `t2` silently anchors it somewhere else.

## How to apply

Anchor a pre-launch position on a row boot recovery cannot remove — the last
**settled** turn:

```sql
SELECT COALESCE(MAX(position), 0) AS p FROM story_entries
 WHERE branch_id = ? AND kind = 'ai_reply'
```

A dangling `user_action` is exactly what recovery reverses; a reply is only ever
written by a turn that committed. Then assert the shape you assumed once the app
is up — `expect(rows).toHaveLength(4)` on the rows above the parked position
turns a future fixture change into a loud failure instead of a mis-mapped handle.

## Why it generalises

Any pre-launch seed write that encodes a **derived** fact about the fixture —
a max position, an entry id, a row count, a watermark — is asserting that boot
is a no-op. Boot is not a no-op: recovery reverse-replays orphans, the drain
clears staleness flags (see
[Staleness flags are cleared by the drain](./staleness-flags-are-cleared-by-the-drain.md)),
and hydrate can prune. Seed absolute facts the fixture owns; derive anything
positional after launch, or anchor it on a row that boot provably leaves alone.
