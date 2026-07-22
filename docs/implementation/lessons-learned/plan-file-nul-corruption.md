# A literal NUL in a plan file silently rewrites the code it specifies

An execution plan that specifies a separator — `join('\0')`, a delimiter
constant, any escape written inside a fenced code block — can end up carrying
a **literal NUL byte** instead of the two-character escape. `file` reports the
plan as `data` rather than `text`; nothing else complains.

**Why it bites.** Reading tools disagree about what they render, silently:
`rg` shows `join(' ')`, `tr -d '\0'` shows `join('')`, an editor may show
nothing at all. Whoever implements the task reads one of those and writes it
into real code. Typecheck, lint, remark, and the test suite all pass, because
the test is written from the same corrupted source and moves with it.

**What it cost.** M3.1a's plan carried five NUL bytes. Its spec chose a NUL
separator and gave a rationale for it; the shipped `compositeText` joins with a
space, and the test that should have caught the change is _named_ after a
single-space separator while its drafted assertions expected NUL. A stated,
reasoned design decision was reversed with no reviewer, no failing gate, and no
record — it took a hand audit two milestones later to notice, and only then
could anyone establish that the divergence happened to be harmless. M3.11's
plan carried three NUL bytes, at exactly the sites defining a dirty-field
serialization separator.

## How to apply

Check any plan that specifies a separator before dispatching from it:

```sh
file .impl-plans/*.md    # every one should say "text", never "data"
```

**Root cause.** Tool-call parameters are JSON, and a six-character Unicode
escape for codepoint zero is a _valid JSON escape_ that decodes to a real NUL
before the file is ever written. Nothing downstream can tell the difference
between "the author wanted a NUL" and "the author wrote an escape".

**How to write it safely.** Don't hand-write a codepoint escape for a control
character into a plan at all. Either double the backslash so the escape reaches
the file as text, or — better — restructure so no separator is needed. In the
M3.11 case the round-trip was removable entirely: the comparison it
approximated already existed in `upsertSection`, so publishing the real array
behind a ref and using `JSON.stringify` only as an effect key was both correct
and simpler. This lesson was itself corrupted twice while being written, which
is the strongest argument available for the restructure over the escape.

Related: [known-answer vectors can share a blind spot](./known-answer-vectors-share-blind-spots.md)
— another case where a green suite proved less than it appeared to.
