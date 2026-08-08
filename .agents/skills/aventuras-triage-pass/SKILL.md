---
name: aventuras-triage-pass
description: Work a batch of Aventuras triage items to closure — classify, wave by dependency, verify each claim before acting, fix or route, and empty the queue. INVOKE when the user asks to tackle triage items, drain the triage inbox, or clear the items a milestone or slice introduced. NOT for filing a single new deferral (that is a one-line append to triage.md).
---

# Triage pass — Aventuras

[`docs/implementation/triage.md`](../../../docs/implementation/triage.md)
is a **queue, not a ledger**. Items land there because no downstream
slice owns them, and they leave by being fixed, decided, routed, or
dissolved. A triage pass is the separate work of emptying some of it.

This skill is the procedure for that pass. It is not a checklist for
fixing bugs — the hard parts are ordering the work so it does not get
done twice, and not trusting the entries.

<HARD-GATE>
**A triage entry is a claim, not a fact.** Re-verify its premise against
the code before you act on it. In a 35-item pass, three entries changed
class on inspection and several carried figures that were wrong by
multiples. Acting on an unverified entry produces a confident fix to a
problem that does not exist.
</HARD-GATE>

<HARD-GATE>
**Gate the verification chain.** Run typecheck, tests, lint and the
item's commit as one `&&`-joined chain, never as separate
newline-separated commands. A newline-separated chain commits
regardless of what failed. This has already put a red test into history
once. The chain is defined here and invoked once per item — nothing
downstream commits a second time.
</HARD-GATE>

## Phase 1 — Scope and classify

Read at runtime rather than assuming; the destinations move as the
project grows:

- `docs/implementation/triage.md` — its own preamble names the legal
  destinations.
- `docs/conventions.md → Followups vs parked` — the placement rule for
  which ledger an item belongs in.
- `.claude/rules/docs.md` — followups hygiene, anchor discipline.
- The milestone's slice docs, if the batch came from one slice — some
  items belong in a sibling slice's Open questions.

Then, for every item in scope:

1. **Name it.** Short stable id (`BUG-1`, `CANON-2`, `COST-4`). The ids
   are for the working ledger only and never reach a committed file —
   a commit message or doc that cites `TOK-3` is citing something the
   reader cannot look up.
2. **Class it.** `CODE` (a fix) · `CANON` (doc follows code, or code
   follows doc) · `DECIDE` (a genuine design call) · `PERF` · `HYG` ·
   contract classes as the project defines them.
3. **Destination it.** Fix now · canon edit · route to a slice's Open
   questions · route to `followups.md` · route to `parked.md` · drop.
4. **Record whether you verified it or took it at face value.** Keep a
   running count. Anything unverified must be re-confirmed at the moment
   its item is picked up, not before.

Write this to a ledger in `_tmp/` (gitignored). See
[Ledger](#ledger) for shape.

## Phase 2 — Wave by dependency, not by class

Grouping by class feels natural and is wrong. Group so that no work is
done against numbers or contracts a later wave changes.

The archetypes, in the order they usually fall:

1. **Live defects.** Anything currently producing wrong output.
2. **Cheap fixes with no design call.** Mechanical, individually
   committable.
3. **Measure, then write.** Any wave that re-derives a documented
   budget, threshold, or cost model **must land the code that changes
   those numbers first, then re-measure, then write canon.** Writing
   canon first means writing it twice.
4. **Canon decisions.** Where doc and code disagree and someone has to
   choose which moves.
5. **Grouped contract decisions.** Items that each propose a change to
   one shared shape. Decide them as a single pass or you get a shape
   that answers each question and coheres with none.
6. **Route to the active ledger.** Items needing a milestone owner that
   does not exist yet.
7. **Designed but unscheduled.** Items whose design is settled and which
   need a slot.

Two ordering rules that are not obvious:

- **Correctness fixes can raise cost.** Do not assume a fix in wave 2
  improves the numbers wave 3 measures. Measure the baseline *before*
  the wave lands — a git worktree at the pre-fix commit, running the
  same harness — or you cannot tell a regression from a correction.
- **Paired items move together.** If two entries are two halves of one
  work item, route them to the same place even when only one is in
  scope. Splitting one work item across two ledgers is worse than
  widening the batch.

## Phase 3 — Per item

The user's review protocol applies to every item that involves a
decision: **ground truth → proposal → sign-off → implement.** Do not
compress it.

1. **Re-verify the entry's premise.** Read the code it cites. Confirm
   line references, quoted values, and claimed behaviour. When the entry
   cites a measurement, be suspicious of it — measurements age worse
   than prose.
2. **Decide the outcome class.** See [Outcomes](#outcomes). Reclassifying
   is a normal, frequent result, not a sign you misread the entry.
3. **Escalate only genuine design decisions.** A judgment call with a
   defensible default is yours. "What should this user-facing control
   actually do" is the user's. When you escalate, lead with the ground
   truth you established, not with the options — and if the user asks a
   question back, **answer it before re-asking anything.**
4. **Implement, with a test that pins the behaviour.** Behaviour-changing
   outcomes only — `Fixed`, and the code half of a `Canon` item where
   code is what moved. A doc edit, a relocation or a deletion has no
   behaviour to pin, and a test written to satisfy this step anyway is a
   vacuous one. For those, the evidence is the resulting doc and ledger
   state: read the destination back and confirm it says what you meant.
5. **Mutation-check the test**, where step 4 produced one. Break the
   thing it claims to cover and confirm it fails. See
   [Test traps](#test-traps) — this is where passes go wrong most
   reliably.
6. **Run the gated chain.** It ends in the item's commit; do not commit
   again after it. One commit per logically separable item.
7. **Remove the triage entry** in the same pass, for every outcome that
   closes or refiles it — `Fixed`, `Canon`, `Routed`, `Dissolved`, and
   the answered half of a `Split`. An item fixed but still queued reads
   as open. `Held` is the exception and stays put; see
   [Outcomes](#outcomes).

## Outcomes

Six, and only the first three are the obvious ones:

- **Fixed.** Code changed, test pins it, entry removed.
- **Canon.** Doc and code disagreed; one moved. Record *why* that one.
- **Routed.** Moved to its real home verbatim apart from link paths and
  positional references ("the entry above" may no longer be above).
  Recompute every relative link from the destination file rather than
  applying a fixed shift — the legal destinations sit at different
  depths, and a slice's Open questions is several levels further down
  than the root ledgers. Preserve the content so the diff reads as a
  relocation.
- **Dissolved.** The entry described something that is not a problem, or
  is a duplicate of an existing mechanism. Delete it — with the
  reasoning in the commit, because "we deleted this" needs to survive.
- **Split.** One entry was two questions. Close the half that is
  answered; refile the half that is not, with an owner.
- **Held.** Stays in the queue with a stated revisit trigger, because no
  action is available and no ledger fits. Legitimate, but say so
  explicitly in the close-out — a held item is not a resolved one.

## Traps seen in practice

**"The spec is silent" is not "the spec decided."** An entry arguing a
change is free because the canonical doc does not mention the
constraint is resting on absence, not on a decision. Absence means the
question is open, and foreclosing it may be the actual cost.

**Doc-wins does not mean doc-is-right.** The rule says the doc is
authoritative when doc and code disagree. It does not say the doc's
content is correct — sometimes canon's own prose already specified what
its own pseudocode prevented, and the item is a bug rather than a
design decision.

**A measurement rig is part of the deliverable.** If a pass measures
anything, commit the harness. Measurements taken once with a discarded
rig cannot be compared against later runs, which turns the next pass
into a rebuild. Keep it out of CI — its own project or target, never
the default test run.

**Watch the direction of your own claims.** Before writing "this made X
faster / smaller / safer", check you measured both sides on the same
rig. Cross-rig comparisons are not deltas.

## Test traps

Adding a guard reliably exposes tests that never pinned anything.
Budget for it — in one 35-item pass, five surfaced, and every new guard
found one.

The shapes, all of which pass while asserting nothing:

- Asserting a derived value but never the outcome that gives it meaning
  (checking a score but never that the row was *selected*).
- A fixture naming an id it never seeds, green only because the code
  accepted anything.
- Seeding content the assertion never reads.
- **Deriving the expected value from the constant under test.**
  `expect(x).toBeCloseTo(base * (1 + CONSTANTS.k))` passes at every
  value of `k` including zero. Use a literal.

The mutation check is the only reliable detector. Copy the file aside
with `cp` — never `git stash`, which strands work if the chain is
killed — mutate, run the scoped test, restore.

**Restore unconditionally.** A mutation check *expects* its test to
fail, so the failing path is the normal one, not the edge case. Never
join the test and the restore with `&&`: the restore then runs only
when the mutation went undetected, which is precisely the run you want
to abandon. Restore on its own line, or trap it, and confirm the file
is back before anything else reads it.

## Ledger

A working file in `_tmp/` (gitignored, disposable). It is a tracker, not
a deliverable — the durable record is the commits and the docs they
change. Keep:

- **Scope + what is deliberately out of scope**, with why.
- **A table per wave**: id, class, destination, one-line summary, status
  (`todo` · `wip` · `done` · `routed` · `held` · `dropped`).
- **Decisions taken**, dated — especially ones the user made, since
  those are not otherwise recoverable.
- **Verification status** — which claims you checked against code versus
  took at face value.
- **A write-up per completed item**: what landed, the commit, what was
  reclassified, and anything that surprised you.
- **A close-out**: totals, items held and why, reclassifications, and
  the lessons worth carrying to the next pass.

## Close-out

The pass is done when every in-scope item has landed on one of the six
[Outcomes](#outcomes) — fixed, canon-decided, routed, dissolved, split,
or explicitly held. Then:

- Confirm the queue shrank by the number you closed, counting a `Split`
  as closed only for its answered half, and that no entry you resolved
  is still present. A `Split`'s refiled half and a `Held` item are both
  expected to still be there.
- Run the full gated verification once more across the whole batch.
- Report totals per outcome, the items you held and why, the owner on
  each `Split`'s refiled half, anything you reclassified, and any
  process failure of your own — an unverified claim you acted on, a
  commit that landed red. Those are the most useful part of the report
  and the easiest to omit.

## Out of scope

- **Filing new deferrals.** A new item is a one-line append to the
  queue; it does not need this skill.
- **Widening the batch opportunistically.** Fix what is in scope. The
  exception is a paired item (see Phase 2), which you widen to
  deliberately and say so.
- **Deciding a user's product questions.** Escalate them with ground
  truth attached.
