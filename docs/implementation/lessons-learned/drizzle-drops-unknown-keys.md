# Drizzle drops keys the table has no column for, silently

`.set({ … })` and `.values({ … })` build their column list from the
**table schema**, not from the object you hand them. A key the table
doesn't define is not an error, not a warning, and not a runtime
throw — it is dropped from the generated SQL and never mentioned
again.

So the natural way to prove a write is correctly gated — "if the
gate leaks, the SQL will fail" — proves nothing. The write succeeds
either way.

## Why

Probed directly against `drizzle-orm` 0.45.2, passing an
`embeddingStale` key to `story_entries`, which has no such column:

```
update "story_entries" set "content" = ? where "story_entries"."id" = ?
params: ["x","e1"]
```

The key is gone. The statement is valid. Nothing observed it.

This matters wherever a write is **conditionally widened** — an
action layer that adds a column only for certain tables, a generic
engine writing rows whose shape depends on the domain. The condition
is exactly the thing you want a test to hold, and the DB cannot see
it fail.

Where it _does_ surface is the store. `createWorkingSetStore`'s
patch is a plain spread (`{ ...existing, ...columns }`) with no
schema filter, so a key that vanished from the INSERT still lands on
the in-memory row. The leak is observable — just not where you'd
look first.

Measured on the cascade-child arm of `lib/actions/delta/reverse-replay.ts`,
which decides whether a restored child row gets `embedding_stale`:

| assertion                      | gate correct | gate removed |
| ------------------------------ | ------------ | ------------ |
| DB row restored, column absent | pass         | **pass**     |
| store row equals its DB row    | pass         | fail         |

Forcing the gate open passed all 1156 tests before the second row
existed.

## How to apply

- **Never write a "the SQL would fail" gate test against Drizzle.**
  It won't fail. Assert on something that can actually observe the
  extra key — usually the store row, since the working-set patch
  doesn't filter by schema.
- **Compare the store row to its DB row** rather than asserting the
  absent key by name. `expect(row).not.toHaveProperty('x')` passes
  vacuously when `row` is `undefined`, which is the common failure
  when a patch didn't fire at all; `expect(storeRow).toEqual(dbRow)`
  cannot, and it catches store/DB drift generally.
- The same blindness applies in reverse to **undo payloads and row
  snapshots**: a whole-row write carrying a column the target table
  lost in a migration will not complain either.

## Related

- [`.toThrow(ErrorClass)` only verifies the class if a typecheck runs beside it](./tothrow-errorclass-needs-typecheck.md)
  — same shape: an assertion that stays green because it silently
  stopped checking the thing it names.
- [Staleness flags are cleared by the drain](./staleness-flags-are-cleared-by-the-drain.md)
  — why a wrongly-clean `embedding_stale` is permanent, and so why
  the gate above is worth pinning at all.
