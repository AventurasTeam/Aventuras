# `.toThrow(ErrorClass)` only verifies the class if a typecheck runs beside it

`expect(fn).toThrow(SomeErrorClass)` reads like it pins two things:
that the code throws, and that it throws _that type_. It pins the
second only while `SomeErrorClass` actually resolves. Delete the class
from the module under test and the assertion keeps passing — it
quietly stops checking anything but "did something throw."

## Why

A named import that the module no longer exports is not a runtime
error under Vitest's ESM interop. The binding resolves to `undefined`,
the test file loads, and the call becomes `expect(fn).toThrow(undefined)`
— which Vitest treats as the no-argument form, i.e. "throws at all."

Measured directly, against `lib/probe/compress.ts`:

| assertion                                                   | class present | class deleted |
| ----------------------------------------------------------- | ------------- | ------------- |
| throw `CaptureDecodeError` → `.toThrow(CaptureDecodeError)` | pass          | pass          |
| throw plain `Error` → `.toThrow(CaptureDecodeError)`        | **fail**      | pass          |

The right-hand column is the hole. The left-hand column is the reason
the pattern is still worth writing: it does catch the regression that
actually happens, which is a throw site reverting to a plain `Error`
while the class stays exported and imported.

Only `pnpm typecheck` sees the deletion:

```
error TS2305: Module '"./compress"' has no exported member 'NoSuchErrorClass'.
```

## How to apply

- **A green `pnpm test:run` is not evidence that custom error types
  are wired.** Any claim of the form "the suite proves it throws
  `XError`" needs `pnpm typecheck` in the same breath. That is the gate
  order the full verification run already uses — the lesson is not to
  quote the test result alone.
- **Don't try to close it inside the test.** `expect(XError).toBeDefined()`
  guards one import in one file and rots on the next rename; the
  compiler already covers every call site for free.
- The blind spot is specific to **module-scoped** classes. Eleven
  `.toThrow(Class)` call sites exist in the repo; the six naming
  `TypeError` / `RangeError` (`lib/ids/bimap.test.ts`,
  `lib/retrieval/vector.test.ts`) cannot hit it, since a global is
  never a missing import. The five naming project classes can:
  `lib/ids/parse.test.ts`, `lib/prompts/validate-includes.test.ts`,
  `lib/probe/compress.test.ts`.

## Related

- [Known-answer vectors can share a blind spot](./known-answer-vectors-share-blind-spots.md)
  — the same shape of failure: a suite that is green because its
  assertions never reach the branch they claim to cover.
