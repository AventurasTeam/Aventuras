# Comments

Comment sparingly and briefly. A comment earns its place only when the code cannot say the
thing itself: an invariant, a non-obvious constraint, a reason to do it this way rather than
the obvious way. Everything else is noise the next reader has to parse and the next editor
has to keep true.

## What not to write

- **History**: "used to be X", "the first version did Y", "this was a bug where…". Git has
  it, and the reader is looking at the present code.
- **Measurements or anecdotes**: "38 rows for 31 people on a 41-chapter save", "a measured
  run spent two of five steps…". These belong in `docs/`, where they are the argument for a
  design, not scattered over the implementation.
- **Self-referential prose**: "this file exists because…", "the whole reason this function
  is here…", "deliberately not X". Say the rule, not the story of the rule.
- **Restatements**: a comment that repeats the line under it, or a docblock listing
  parameters the signature already names.

## Length

Prefer one line to three. If the explanation genuinely needs a paragraph, it is design
rationale: put it in the relevant `docs/architecture/*.md` and, at most, point at it.

```ts
// Good
// Indices stay valid for the whole session, so a delete leaves its slot behind.
// Bad
// A delete used to splice the array, which shifted every index the model already held and
// made the next update land on the wrong entry — see the session of 2025-11 where…
```

## Existing comments

Existing code has plenty of the long form. Leave it alone unless you are already editing
that block; do not add more of it.
