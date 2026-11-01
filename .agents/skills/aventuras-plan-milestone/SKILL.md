---
name: aventuras-plan-milestone
description: Use when promoting an Aventuras roadmap entry into a defined milestone with its slice docs. Invoke as a manual slash command, never automatically.
---

# Plan a milestone from a roadmap entry

Promote one planned milestone in `docs/implementation/roadmap.md` into `docs/implementation/milestones/NN-name/`: `milestone.md`, every slice doc, the shrunken roadmap entry and the index row.

These docs are the basis for weeks of work, and one session that reads everything, decides everything and writes everything runs thin. So the work splits, but not evenly:

- **You own the layout:** the slices, their order and the contracts between them. Those decisions depend on each other, so they stay in one head.
- **Subagents feed it and attack it.** Researchers read canon and code so the layout rests on what's there. Proposers give you real alternatives. Auditors try to break it before anything is written on top of it. Writers then give each slice a whole agent's attention.

The order matters as much as the split. Code is read first and contracts are audited before any slice doc exists, because a contract defect found after drafting costs a redraft.

**Announce at start:** "I'm using the aventuras-plan-milestone skill to author milestone <M>."

<HARD-GATE>
This skill writes milestone and slice docs. It does NOT:

- Modify any canonical spec under `docs/data-model.md`, `docs/architecture.md`, `docs/generation-pipeline.md`, `docs/memory/`, `docs/ui/`, `docs/calendar-systems/`, `docs/observability.md`, `docs/tech-stack.md` or `docs/conventions.md`. Canonical specs are gated through `aventuras-design`; if planning reveals a canonical spec must change, don't edit it here. Stage 4 sorts how each gap gets answered.
- Author implementation plans under `.impl-plans/`. That's `aventuras-writing-plans`. This skill stops at the slice doc.
- Promote a roadmap entry that's still ambiguous. If its scope reads provisional, surface that as the first finding and ask the developer to firm it up.
- Write a slice doc before the developer has approved the layout and triaged the contract audit.
- Commit without showing the developer the final audit's findings and the fixes applied.
</HARD-GATE>

## Invocation

Triggered as a slash command, with the target milestone as argument:

- `/aventuras-plan-milestone M3`: plan milestone 3, with the slug derived from the roadmap entry's heading.
- `/aventuras-plan-milestone M3 memory-floor`: plan it with an explicit slug.

The slug is kebab-case, and the directory is `NN-<slug>`, zero-padded, such as `docs/implementation/milestones/03-memory-floor/`.

## Stages

Create a task for each stage; complete them in order.

| # | Stage | Who | Output | Gate |
|---|-------|-----|--------|------|
| 1 | Read inputs | You | | |
| 2 | Readiness check | You | | Stop if not ready |
| 3 | Research | One researcher per domain, plus the promises sweep | `research-*.md`, `gaps.md` | |
| 4 | Layout | Three proposers, then you | `layout-*.md`, `layout-decision.md` | Developer approves the layout |
| 5 | Skeleton | You | `milestone.md`, `slices.md` | |
| 6 | Contract audit | Three auditors, then you | `audit-*.md` | Developer triages |
| 7 | Slice docs | One writer per slice | Slice docs | |
| 8 | Final audit | Auditors, then you | `final-*.md` | Developer triages |
| 9 | Close | You | Roadmap, index, commit | |

**Working directory.** `.impl-plans/M<NN>-planning/`, which is git-ignored. Every agent's output goes there except the slice docs. These files are the run's state: after an interruption, resume at the first stage whose output is missing.

**Dispatching.** Each role is an agent definition in `.claude/agents/`, and the templates beside this skill hold the per-dispatch part. Agents run three at a time by default: before each fan-out, tell the developer the number of agents and the concurrency, and let them change it. Without Claude Code agent definitions (another harness), dispatch a general subagent whose prompt is that definition file's body followed by the filled template.

**An agent's report is a claim.** Mistakes come back in the same confident voice as findings. Before a claim shapes a contract or reaches the developer as a finding, check it yourself at the `file:line` it cites if anything rests on it.

## Stage 1 — Read inputs

- `docs/implementation/roadmap.md`: the target milestone's section, and the cross-cutting tables ("Surfaces that ship incrementally", "Subsystems that ship incrementally"), which often name work that belongs here but isn't in the entry's bullets.
- `docs/implementation/conventions.md`: the milestone and slice templates. Authoritative on doc shape.
- `docs/implementation/README.md` and `docs/implementation/milestones/README.md`.
- The most recent `milestone.md`, for shape. Read another only when a specific precedent matters.

## Stage 2 — Readiness check

A roadmap entry is ready to promote when:

- Its goal is stable and still matches canon: no `?` markers, and no goal describing a design canon has since replaced.
- Its scope is firm: no "TBD" or "we might do X or Y" that leaves open what the milestone is. Long authoring notes, split candidates and an oversized slice aren't readiness problems. Stage 4 settles those.
- Its Gates field names a prior milestone that's already authored.
- Cross-cutting table entries naming this milestone settle the work attributed to it, not "M3 or M4, TBD".
- Anything the entry or the tables say wants a design pass has had it.

If any of these fail, stop and report them one question at a time. The developer can rule on the spot and the run carries on, or firm up the entry first. Don't firm up ambiguity yourself: the developer owns the entry's shape.

## Stage 3 — Research

Split the milestone into domains, 3 to 6 of them, each small enough for one agent to read its canon whole. Cut by system, not by the roadmap's slices: the slice list is what this run decides, and research cut along it can't show that a slice is wrong. Cover the substrate the milestone extends as well as what it adds.

Dispatch one `aventuras-milestone-researcher` per domain with [`researcher-prompt.md`](researcher-prompt.md), plus the promises sweep in that template, which always runs: earlier work defers to a milestone in places its entry doesn't carry, and nothing fails when one is missed.

When they're back:

1. Read every digest.
2. Read the canon the milestone exists to build yourself, whole. Digests tell you where to look and what the code does. They don't replace it, and without it you can't weigh a proposal or challenge the developer.
3. Check the claims the layout will rest on against the code.
4. If a finding changes what the milestone is, raise it with the developer before Stage 4, one question at a time. Keep the rest for the layout gate.
5. List what canon contradicts or leaves undecided in `gaps.md`, each with the work it blocks. Where a check can settle one, run it now if it's cheap. Don't stop for the rest: a layout needs to know which slice a gap blocks, not how it's answered, and Stage 4 sorts them once it can see what rests on each.

## Stage 4 — Layout

Dispatch three `aventuras-layout-proposer` agents, one per priority, with [`layout-proposer-prompt.md`](layout-proposer-prompt.md). Give them the developer's rulings so far and `gaps.md`, not your preferred layout.

Read all three, then write `layout-decision.md`:

- **Agreements.** Cuts they all make. These are probably sound.
- **Disagreements.** Each real difference, what each side gains, and what would decide it.
- **Recommendation.** One proposal as the base, plus specific changes from the others, each with its reason. Don't merge cut by cut: a layout averaged from three loses what held each one together. Cuts pile up at this step, so each change that adds a slice names the edge it frees or the work it lets you shed. State the final count, with nothing moved out of the milestone, beside the last two shipped milestones' counts. If it's well above theirs and the scope doesn't explain that, merge before presenting it. Hold the result to the proposers' sizing rule too: take estimates from the proposals instead of shaving one to fit, and split what's still above about 20 tasks.
- **Departures from the entry.** Each slice split, merged, added, dropped or moved, with the reason. Anything leaving the milestone names the roadmap entry that takes it.
- **Gaps.** Every gap from `gaps.md`, sorted by how it gets answered now the layout shows what rests on it. Size doesn't sort them: a gap can reshape every consumer and still be one fact to check.
  - **One slice's question:** nothing outside one slice depends on the answer. It goes to that slice's Open questions, for `aventuras-plan-slice`.
  - **A fact:** a check settles it. If it can't run now, the first task of the slice resting on it runs it, and the contract says what follows from each result.
  - **A ruling:** it crosses slices, and the developer can decide it at this gate. Rulings that change canon still go through `aventuras-design` before the slices resting on them start: batch them into one pass, at a few paragraphs each.
  - **A design packet:** it crosses slices, has real options, and needs working through. Only these need a session of their own. Group them, and name the slices each one gates.

The roadmap entry is a hypothesis, and its own header says so. Departures are normal, but they're the developer's to approve.

Present the recommendation and work through the disagreements one question at a time, leading with your recommendation. Skip anything canon, `conventions.md` or a prior milestone's precedent already settles. Ask only the rulings and packets: the other two sorts need nothing from the developer. For a design packet, offer the [`aventuras-design`](../aventuras-design/SKILL.md) route the way `aventuras-plan-slice` does; don't invoke it yourself.

## Stage 5 — Skeleton

Contracts can rest on rulings and checked facts. Only a design packet can hold this stage, and the developer picks one of two routes for each:

- **Sequence it.** The contract waits behind the slice the packet gates, the graph carries that gate, and this stage goes ahead. Prefer this where the layout allows it.
- **Wait for it.** A contract other slices have to pin now can't be written over an open packet: it would be a guess, and with canon silent the audit has nothing to check it against. Run `aventuras-design`, reread what it changed, and resume here.

Write `milestone.md` per [`conventions.md → Milestone doc structure`](../../../docs/implementation/conventions.md#milestone-doc-structure). Sections in order: Goal, Why now, Narrative / overview, Slices, Dependency graph, Slice contracts, Definition of done, Open questions.

- **Goal:** one short paragraph, stable once written.
- **Narrative / overview:** how the slices compose. Someone reading only this should understand what's being built.
- **Dependency graph:** the binding declaration.
- **Slice contracts:** every type, interface and behavior crossing two or more slices is pinned here or explicitly sequenced, per [`conventions.md → Sequencing vs doc-as-contract`](../../../docs/implementation/conventions.md#sequencing-vs-doc-as-contract). Each contract cites the code it extends, `file:line`, and you've read that code.
- **Definition of done:** verifiable pass or fail criteria.
- **Open questions:** milestone-scope unknowns, including each open design packet and the slices it gates. Slice-specific ones go in the slice.

Then write `slices.md` in the working directory, with one entry per slice:

```markdown
### Slice <M>.<N> — <title>

- **File:** `slices/NN-slug.md`
- **Depends on / Blocks:** slice ids
- **Goal:** one sentence
- **Scope in:** deliverables, specific enough to tell if a thing is in
- **Scope out:** near-misses, with the slice that owns each
- **Contracts:** ids this slice provides and consumes
- **Promises:** must-land items it takes from `research-promises.md`
- **Research:** the digests to read
- **Seams:** the code it extends, `file:line`
- **Size:** plan-task estimate
```

A writer later sees only this, the milestone doc, the repository and canon, so the entry must decide everything that crosses slices. Check that every must-land promise lands in an entry and every contract has exactly one provider.

## Stage 6 — Contract audit

Audit the skeleton while fixing it still costs an edit. Dispatch three `aventuras-milestone-auditor` agents with the `code`, `seams` and `coverage` angles in [`auditor-prompt.md`](auditor-prompt.md). The `code` and `seams` auditors don't get the digests: they need a reading of the code that doesn't inherit the researchers' or yours.

When they're back, deduplicate, check each load-bearing claim yourself, and present one list sorted by class within impact: `blocking`, `important`, `suggested`. Each finding has a location, a description, its evidence and a recommended fix, marked with what you verified and what you didn't.

The developer triages; apply only what they approve. A fix to a contract is unaudited until it's rechecked, so rerun the `code` angle on what the last round changed. Fixes breed findings, so stop after two rechecks: list what the last round changed as unaudited in the milestone doc's Open questions. If a contract is still taking blocking findings, raise it as a ruling or design packet instead of patching it again.

The audit doesn't add slices. A size finding reopens the layout with the developer, and only for a slice above about 20 tasks.

## Stage 7 — Slice docs

Dispatch one `aventuras-slice-writer` per slice with [`slice-writer-prompt.md`](slice-writer-prompt.md). Two small adjacent slices sharing most of their reading may share a writer. Each writer writes only its own slice doc.

Handle each report:

- **A real contract problem:** fix `milestone.md` and rerun every writer whose slice uses that contract.
- **A scope correction within a slice:** check it, and keep it if it's sound.
- **A cross-slice open question:** settle it, ask the developer if it's a planning decision, and fix the docs it touches.

## Stage 8 — Final audit

Dispatch the `slice-docs` angle once per four slices, and the `set` angle once, per [`auditor-prompt.md`](auditor-prompt.md). Deduplicate and check the findings as in Stage 6.

Present one list to the developer and ask which to apply. DO NOT auto-fix: even mechanical-looking fixes go through the developer. You may group mechanical findings so a whole class can be approved at once. Ask before applying a fix whose shape isn't obvious.

## Stage 9 — Close

1. Apply each approved fix.
2. Run `pnpm lint:docs`. If it fails, fix the underlying issue rather than silencing it; broken anchors are usually heading typos. In an Orca worktree it refuses its own root, because `.remarkignore` lists `.worktrees/`: copy `.remarkignore` minus that line to a scratch file, then run `pnpm exec remark . --quiet --frail --ignore-path <scratch file> --ignore-path-resolve-from cwd`.
3. Run `pnpm prettier --check` on the touched files. If it fails, run `pnpm prettier --write` and re-run the lint. Watch for prose mangling per [`lessons-learned/prettier-prose-wrap-traps.md`](../../../docs/implementation/lessons-learned/prettier-prose-wrap-traps.md).
4. **Promote the roadmap entry.** Replace its section in `docs/implementation/roadmap.md` with a one-line pointer per [`roadmap.md → How to read this doc`](../../../docs/implementation/roadmap.md#how-to-read-this-doc).
5. **Carry what moved.** Add each item the layout moved to another milestone to that milestone's roadmap entry. Nothing else records it, so it's lost if this commit doesn't.
6. **Update the index.** Add a row to `docs/implementation/milestones/README.md → Defined milestones`, matching the existing shape.
7. Stage every touched file and check the diff is contained: the milestone directory, the roadmap promotion and carried items, the index, and any audit-triggered minor edits.
8. Commit with the message `plan: M<N> — <name> (milestone + slices)`. Body optional; per [`CLAUDE.md → Commit messages`](../../../CLAUDE.md#workflow-rules), keep it tight, and record the decisions made at promotion.

## Out of scope

- Authoring or modifying canonical specs. Spec changes go through `aventuras-design`.
- Authoring `.impl-plans/` execution plans. Those belong to `aventuras-writing-plans`, after the slice is approved.
- Roadmap entries other than the target, beyond carrying what this layout moved to them. Cross-milestone reshuffling is a roadmap edit.
- CLAUDE.md, README hierarchies and other repo-meta files, unless an audit finding requires it.
- Lessons-learned citations in slice Required reading. The developer keeps that as a manual step: flag entries that look applicable, but don't add them silently.

## Common mistakes

| Thought | Reality |
|---------|---------|
| "The entry lists it as one slice, so it's one slice" | The entry is a hypothesis written before the research. Size it, and take the split to the developer. |
| "Audit once everything's drafted" | Contract defects found after drafting cost a redraft, and they're where the blockers are. Audit the skeleton. |
| "The contract reads clean against canon" | Canon can't show what the code won't do. Each contract cites the code it extends. |
| "The digest covers it, no need to read canon" | You'll be weighing proposals and challenging the developer from a summary. Read what the milestone exists to build. |
| "Take the best parts of each proposal" | Pick a base and name each change. Averaged layouts lose their reasoning. |
| "Thinner slices are safer" | Each one costs a doc, a plan, a review and often a contract, and no later stage merges them back. Compare with what shipped. |
| "A split here frees no edge, so it stays whole" | Above about 20 tasks, size is reason enough. The edge test only applies below that. |
| "Canon has a gap, so it needs a design session" | Most gaps take a slice's own planning, a check or a ruling. Only one with real options that crosses slices needs a session. |
| "It's a big gap, so it's a packet" | Size doesn't sort gaps. Ask what would answer it. |
| "It can move to a later milestone" | Then that milestone's entry says so in this commit, or the work is lost. |
| "The auditor's finding sounds right" | Check it at the `file:line` before it reaches the developer. |
| "It's only mechanical, I'll just fix it" | Findings go through the developer, even mechanical ones. Group them instead. |
| "Nothing fails, so nothing's missing" | Work that's inert until this milestone supplies it fails silently. That's what the promises sweep is for. |
