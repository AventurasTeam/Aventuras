---
name: aventuras-comment-audit
description: Strict audit of every code comment a commit range touched — deletes the classes `.claude/rules/code.md` bans, prunes valid-but-padded blocks, and compresses the survivors to one or two lines. Applies edits in place. INVOKE before opening a PR, before a milestone merge, or when the user asks to clean up comments / says comments have got bloated. Range defaults to `origin/main...HEAD`.
---

# Comment audit — Aventuras

Audit and rewrite the comments a commit range introduced, against
[`.claude/rules/code.md → Commenting discipline`](../../../.claude/rules/code.md).
Unlike `aventuras-doc-audit` and `aventuras-drift-check`, this skill **applies
its edits** — the working tree is the report and `git diff` is the review
surface.

## The failure mode this exists for

Agents in this repo have internalized "don't narrate what the code does."
They have not internalized brevity. A measured range (5 commits, 155 files)
carried 1733 added comment lines against 12830 added source lines — **13.5%** —
concentrated in 540 blocks of three lines or more. Almost none of it narrated
the *what*. It was legitimate *why*, inflated four-to-eleven lines wide.

**So the primary verdict is COMPRESS, not DELETE.** A pass that only hunts for
comments restating their own identifiers will find almost nothing here and
report the file clean. Judge every block against a two-line ceiling, not
against the ban list alone.

<HARD-GATE>
Never delete a comment that records a hazard, a platform bug workaround, or a
"do not do X" directive. Compress it instead. Losing one of those is strictly
worse than leaving ten padded blocks. See [Never lose](#never-lose).
</HARD-GATE>

## When to invoke

- **Before opening a PR** or before a milestone branch merges.
- **User asks** to "clean up comments", "audit comments", says comments have
  "got bloated" / "read like an essay".
- **After a slice lands** that a subagent-driven session implemented — that
  path produces the densest commentary.
- **Dispatched by `aventuras-finishing-a-development-branch`** at its Step 1.6,
  when the user takes the offer. That is the intended default route — it lands
  the cleanup in the same merge or PR as the work.

Not autonomously after every edit. This is a range-scoped sweep.

## Do not use the installed `comment-analyzer`

The `pr-review-toolkit:comment-analyzer` agent available in this environment
pulls the opposite direction — it carries an "Assess Completeness" pass that
recommends *adding* context "for the least experienced future maintainer."
Running it on this repo makes the problem worse. This skill supersedes it.

## Checklist

Track as tasks; complete in order:

1. **Read the rule at runtime.** `.claude/rules/code.md → Commenting
   discipline`. It is the spec; this skill is only the procedure. If the two
   disagree, the rule wins — and say so in the summary.
2. **Enumerate.** `node .agents/skills/aventuras-comment-audit/find-comment-blocks.mjs <range>`.
   Prints totals and the batch plan as JSON.
3. **Sanity-check the plan.** If `candidateBlocks` is 0, stop and report — the
   range added no multi-line comments. If `batches` exceeds ~20, raise
   `BLOCK_BUDGET` rather than dispatching a swarm.
4. **Dispatch one subagent per batch**, in parallel, using
   [the brief](#subagent-brief). Batches hold disjoint file sets, so
   concurrent writes never collide — this is the invariant that makes parallel
   application safe. Do not hand the same file to two subagents.
5. **Verify.** [Verification](#verification) — non-comment drift check, then
   lint / format / typecheck.
6. **Summarize** per [Output format](#output-format). Leave everything
   unstaged.

## Verdicts

Every candidate block gets exactly one.

### DELETE

Remove entirely. The classes `code.md` bans outright:

- **Narrates the what.** The identifiers already say it.
- **References the task, PR, slice, or a recent fix** — "added for the cast
  flow", "per review feedback", "fixes #123". Belongs in the commit message.
- **Compares to a prior approach** — "we used to…", "the previous approach
  didn't work", "no longer guarantees…". Git history owns this.
- **Section headers** in a file that has no sections (`// ---- helpers ----`).
- **Restates a type or signature** that is right there.

### PRUNE

The block mixes a real constraint with padding. Cut the padding, keep the
constraint, then apply COMPRESS to what survives. This is the most common
verdict after COMPRESS — bloated blocks usually carry one load-bearing
sentence buried in three of setup.

### COMPRESS

The whole block is justified. Rewrite it to **one line where possible, two at
most**. Three only for a genuinely multi-part hazard. See
[Compression rubric](#compression-rubric).

### KEEP

Already terse, or protected:

- **Contract JSDoc on an exported symbol** — allowed values, units, edge
  cases, prop documentation. `code.md` permits this explicitly. An eight-line
  JSDoc enumerating a union's variants looks like bloat and is not; leave it.
- **Anything on the [Never lose](#never-lose) list** that is already short.
- **Comments the range did not touch.** Out of scope, full stop.

### FLAG

The prose is genuinely load-bearing and genuinely does not fit in two lines —
so per `code.md` it belongs in `docs/`, cited by a one-line comment. **Do not
perform that extraction.** It requires a doc-placement judgment and touches
files outside the range. Report it for the user to route.

## Never lose

Compress these; never delete them. Each is drawn from a real hazard class in
this repo:

- **Deadlock, reentrancy, and lock-ordering warnings.** `withKeyLock` is not
  reentrant; a comment saying so is load-bearing.
- **"Do NOT do X" directives that state a consequence.** The directive plus
  the consequence must both survive.
- **Platform-specific bug workarounds.** RN-Web vs native divergence,
  rn-primitives gaps, Reanimated scheduling, RN-SVG attribute support,
  Android-only failures. These are unguessable from the code.
- **Magic-number provenance.** Why 1024, why 30, why this timeout.
- **Non-obvious ordering or timing requirements.** "must run before X",
  "measured once on mount".
- **Test-intent notes** naming the invariant an assertion pins. Green ≠
  covered in this repo; a note explaining why a test exists stops a future
  agent from deleting it. Compress hard, but keep the invariant named.

If you are unsure whether a sentence is load-bearing, **keep it and compress
it**. Asymmetric cost.

## Compression rubric

Apply in order. Each cut below is from real code in this repo.

**1. Doc citations: keep the pointer, drop the summary.** The repo cites
canonical docs from comments (42 instances in the measured range). The doc is
the source of truth; restating its content in a comment guarantees drift.

```
- // wizard.md → Compact row presentation: `⭐ Set as lead` moves the lead in one
- // click without opening the editor, so the row needs its own action slot.
+ // wizard.md → Compact row presentation.
```

**2. Cut counterfactual build-up to the consequence alone.** "Without this…",
"Otherwise…", "If we didn't…" — keep the consequence, drop the setup.

**3. Drop restatement of what the code says**, keep only the why.

```
- // ExpandableRow's own slot, which renders outside the row-wide
- // expand Pressable: nested in `compact` this would be a button
- // inside a button. Collapsed rows only — the expanded editor
- // carries the same button, and two would share one name.
+ // Outside the row Pressable; nesting in `compact` = button-in-button.
+ // Collapsed only — the expanded editor carries the same button.
```

**4. Lead with the hazard, not the narrative.** Eleven lines to three, with
the placement rule, the failure mode, and the reentrancy warning all intact:

```
- // Serializes concurrent dispatches that target the same key: the second
- // caller's body doesn't start until the first's has fully settled. Needed
- // wherever a read-then-decide isn't atomic with its write — two interleaved
- // callers can both observe the pre-write state and both commit, producing two
- // delta log entries for one conceptual change (breaks the
- // one-CTRL-Z-undoes-it acceptance criterion). The lock must wrap the read, not
- // just the write, so it goes wherever that sequence actually lives. An
- // in-process map suffices because every domain write originates from a single
- // JS realm (the renderer, or the native host); Electron main owns the db file
- // and serves queries but never writes domain rows itself. Not reentrant — a
- // locked body must not re-enter the same key.
+ // Must wrap the read, not just the write: two interleaved read-then-decide
+ // callers both commit, yielding two delta entries for one change. In-process
+ // map suffices — all domain writes originate in one JS realm. Not reentrant.
```

**5. Same rubric inside JSDoc.** A `/** */` wrapper is not a licence for
prose. Eight lines to three, deadlock warning preserved:

```
- * Keyed on this action rather than on `updateStoryEntryMetadata`: what needs
- * serializing is the read-then-decide below, which only this function performs.
- * That leaves it unserialized against the pipeline's own dispatches of that
- * kind — safe only because every one of them runs under a `hard-gate` pipeline,
- * which `isUserEditBlocked` rejects. Do not close that gap by sharing the key
- * with `applyDeltaAction`: `withKeyLock` is not reentrant, so the inner call
- * would await the outer's own promise and deadlock.
+ * Own lock key: only this function does the read-then-decide. Unserialized
+ * against pipeline dispatches — safe because those run hard-gated. Don't share
+ * the key with `applyDeltaAction`: `withKeyLock` isn't reentrant → deadlock.
```

**Mechanics.** Prettier does not reflow `//` comments, so wrapping is manual:
match the file's existing wrap column, never exceed `printWidth` 100. Keep the
comment's existing indentation and its position relative to the code it
annotates.

## Subagent brief

Get the batch's file list with
`node .agents/skills/aventuras-comment-audit/find-comment-blocks.mjs --batch <N> <range>`,
then dispatch with a general-purpose subagent. **Set an explicit model** —
omitting it inherits an expensive default.

```
Audit and rewrite code comments in the files below. You APPLY edits directly.

FIRST: read `.claude/rules/code.md` (Commenting discipline) and
`.agents/skills/aventuras-comment-audit/SKILL.md` (Verdicts, Never lose,
Compression rubric). They are your spec.

<paste the --batch output here>

Rules:
- Only touch comments intersecting the "in-range lines" listed per file.
  Comments outside those ranges are pre-existing and OUT OF SCOPE.
- The candidate blocks are a starting point, not the whole job. Also judge
  single-line and trailing comments inside the in-range lines.
- Read each file fully before editing — a verdict needs the surrounding code.
- Change ONLY comment text. Not one token of code, not one import, not one
  blank line between statements.
- Default verdict is COMPRESS to one or two lines. DELETE only the classes
  code.md bans outright. Never delete a hazard, platform workaround, magic-
  number provenance, or "do not do X" directive — compress those instead.
- Contract JSDoc on exported symbols stays.
- If prose is load-bearing and genuinely cannot fit two lines, leave it and
  report it as FLAG. Do not extract anything into docs/.
- Wrap at the file's existing column, max 100.

Return ONLY: for each file, a list of `file:line — VERDICT — before→after
line count`, then a FLAG section, then a one-line note on anything you
deliberately left alone and why. No prose preamble.
```

## Verification

Run after every batch returns.

**1. Prove only comments changed.** The load-bearing check — a subagent that
edits code while "cleaning comments" is the real risk.

```sh
git diff -U0 -- '*.ts' '*.tsx' | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -vE '^[+-][[:space:]]*(//|/\*|\*)' | grep -vE '^[+-][[:space:]]*$'
```

Every line this prints must be a **trailing-comment edit** (`const x = 1 // why`),
which legitimately shows the whole code line. Anything else is a subagent that
touched code — revert that file and re-dispatch it.

**2. Then the standard gates:**

```sh
pnpm format:check && pnpm lint && pnpm typecheck
```

`pnpm format:check` catches over-long comment lines the rubric's wrap rule
missed. Tests are not required — comments do not affect behavior — but run
`pnpm test --project unit` if step 1 printed anything you had to reason about.

## Output format

Inline in your response, terse:

```
# Comment audit — <range>

Scope: <N> files changed, <M> with candidates, <B> blocks, <K> comment lines.
Result: <X> deleted, <Y> pruned, <Z> compressed, <W> kept. <lines> → <lines>.

## Flagged for you
- file:line — <one line on why it doesn't fit in two lines>

## Judgment calls
- file:line — <anything a reviewer might disagree with>

Verification: comment-only diff <clean | N trailing-comment lines reviewed>.
format/lint/typecheck: <pass|fail>.

Unstaged. Review with `git diff`, revert with `git checkout -- <path>`.
```

Do not list every compressed block — that is what `git diff` is for. Report
counts, flags, and judgment calls only.

## Out of scope

- **Comments the range didn't touch.** Even obviously bad ones. Report the
  worst in one line if you must, but do not edit them.
- **Extracting prose into `docs/`.** FLAG only.
- **Markdown, JSON, YAML, config comments.** TS/TSX/JS/JSX only.
- **Code changes of any kind**, including "obvious" fixes spotted in passing.
  Report them; do not apply them.
- **Commit or stage.** The user reviews the diff.

## Constraints

- **The rule file is the spec, this skill is the procedure.** Read
  `.claude/rules/code.md` every run; it evolves.
- **Asymmetric caution.** Over-deleting costs more than under-compressing.
  When genuinely torn, compress and keep.
- **Disjoint batches.** Never dispatch the same file to two subagents.
- **Report what you left.** A block you decided not to touch, in a file you
  audited, is a judgment call the user may want to overturn.
