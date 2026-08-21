# `eslint --fix` merges a module and its `.native` sibling into one import

A test that imports both `./transaction` and `./transaction.native` looks
fine, passes, and then gets **silently rewritten by the pre-commit hook**
into a single import — after which the native symbol is an alias for the
web implementation.

## Why

The ESLint resolver maps `./transaction` and `./transaction.native` to the
same module: platform extensions are a Metro/bundler resolution feature,
not a filesystem-path distinction the resolver models. Both specifiers
resolve to one file, so `import/no-duplicates` sees two imports of the same
module and merges them:

```ts
// what you wrote
import { runInTransaction } from './transaction'
import { runInTransaction as runInTransactionNative } from './transaction.native'

// what `eslint --fix` commits
import { runInTransaction, runInTransaction as runInTransactionNative } from './transaction'
```

`runInTransactionNative` now points at the **web** implementation.

The failure mode is what makes this expensive. Assertions that differ
between the two platforms fail, so you notice those. Assertions that hold
for both — the majority, since the platform files exist precisely to share
a contract — keep passing, but they are now **vacuous**: they exercise the
web module twice and prove nothing about native. A partially-red suite
where the green half is meaningless reads like an ordinary bug in the red
half.

Instance (Slice 3.12a, Task 2): `lib/db/runtime/transaction.test.ts`
imported both siblings to test an empty-op short-circuit added to each. The
file was verified green, staged, and the pre-commit `eslint --fix` merged
the imports. One native assertion went red; the other passed against the
web implementation. Caught only because tests were re-run **after**
committing rather than trusting the pre-commit pass.

## How to apply

- **Never import a module and its `.native` sibling in the same file.** Put
  the native tests in their own `*.native.test.ts` and record the reason
  above the import, so the pair is not merged back by a later cleanup.
- **Re-run the suite after committing, not just before.** `eslint --fix`
  and `prettier` both rewrite staged files inside the hook; a pre-commit
  green is a statement about the code you wrote, not the code that landed.
  This is the general lesson — the `.native` case is one instance of it.
- Diagnostic signature: a test that passed seconds ago fails immediately
  after commit, and the diff of the committed file differs from what you
  wrote. Check the import block first.
- When a mutation check on a platform file produces fewer failures than
  expected, confirm the test is importing the implementation it names
  before trusting the count.

Related: [`.toThrow(ErrorClass)` only verifies the class if a typecheck runs
beside it](./tothrow-errorclass-needs-typecheck.md) is the same family — an
import that silently resolves to the wrong thing degrades an assertion to
something weaker without failing.
