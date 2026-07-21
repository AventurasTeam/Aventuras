# Known-answer vectors can share a blind spot

JavaScript's bitwise operators (`^`, `|`, `<<`) evaluate to a
**signed** int32. A hash implementation that ends its avalanche on
a bitwise op and formats the result directly emits a negative,
variable-width string for every value whose high bit is set:

```ts
h32 = h32 ^ (h32 >>> 16)
return h32.toString(16).padStart(8, '0') // '-77e5d848' for half of all inputs
```

The `padStart(8, '0')` does nothing to help — the string is already
nine characters. Terminate the chain with `>>> 0` before
formatting:

```ts
h32 = (h32 ^ (h32 >>> 16)) >>> 0
```

## Why the tests passed anyway

The suite pinned the three xxh32 vectors everyone publishes:

| input   | expected   | high bit |
| ------- | ---------- | -------- |
| `''`    | `02cc5d05` | clear    |
| `'a'`   | `550d7456` | clear    |
| `'abc'` | `32d153ff` | clear    |

All three hash below `0x80000000`, so none of them ever reached the
broken branch. A known-answer suite inherited wholesale from a spec
inherits that spec's coverage, and canonical vectors are chosen to
be memorable, not to span the output space. Three green
assertions bought no confidence in half the input domain.

The bug surfaced only when a stored hash was read back off a real
device and had a minus sign in it.

## How to apply

For any function whose output space has a sign-sensitive or
width-sensitive region:

1. Add a vector that lands in the dangerous region on purpose
   (here, any input whose hash sets the high bit), alongside the
   published ones.
2. Assert the **format invariant** over a sweep, not just point
   values:

   ```ts
   for (let i = 0; i < 500; i += 1) {
     expect(sourceHash(`row-${i}`)).toMatch(/^[0-9a-f]{8}$/)
   }
   ```

A sweep like that catches the whole class — sign leaks, short hex,
uppercase drift — without needing to know which specific input
misbehaves.

## Why it matters more when the value is persisted

This hash is stored in vec0 rows as a staleness tripwire. Correcting
the format changes every previously written hash, so every row
mismatches and re-embeds. That is the tripwire working as designed,
but it means the cost of finding this class of bug rises sharply
after ship: pre-merge it cost one re-embed of a dev database.
Audit persisted derived values before they reach users.
