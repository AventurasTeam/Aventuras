# Token-counting fixtures must be prose, not a repeated character

`'x'.repeat(4000)` and 4000 characters of ordinary text are the same
length and nowhere near the same cost to tokenize:

| fixture             | tokens | encode |
| ------------------- | ------ | ------ |
| `'x'.repeat(400)`   | 50     | 26 ms  |
| `'x'.repeat(4000)`  | 500    | 620 ms |
| 400 chars of prose  | 89     | ~0 ms  |
| 4000 chars of prose | 889    | ~0 ms  |

## Why

`js-tiktoken` splits input on a word-boundary regex before it merges
anything. A run of one repeated character contains no boundary, so it
reaches the byte-pair loop as a **single word** and each merge pass
rescans the whole sequence — quadratic in the length of that one word.
Prose splits into many short words that merge independently, which is
why its cost stays flat as length grows.

The `o200k` encoder build is a separate one-time ~272 ms, paid by the
first `countTokens` call in a process.

## How to apply

Any fixture that reaches the real `countTokens` / `countEntryTokens`
(`lib/retrieval/tokens.ts`) gets prose. Length can be whatever the test
needs — it is the absence of word boundaries that costs, not the size:

```ts
// Not this
const LONG = 'x'.repeat(4000)
// This
const LONG = 'the quick brown fox jumps over the lazy dog. '.repeat(90)
```

A fixture feeding a **stubbed** counter is unaffected, and rewriting it
buys nothing: `lib/retrieval/ranker.test.ts` injects
`(t) => Math.ceil(t.length / 4)` and keeps `'x'.repeat(4000)` safely.
Check whether the real encoder is reachable before changing anything.

## Why it reads as flake

The cost is invisible until the machine is slow enough. Five `LONG`
encodes in `hooks/use-open-region-tokens.test.tsx` ran in ~1.3 s per
test locally and passed; the same tests timed out at vitest's 5 s
default on CI. A CI-only timeout in a token-counting test is a fixture
smell first and an infrastructure problem second — measure an encode
before reaching for `testTimeout`. Raising the timeout would have kept
a 600 ms-per-call fixture in a suite that runs on every push.
