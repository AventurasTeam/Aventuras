# Execution Plan Template

Copy the fenced block below into `.impl-plans/<milestone>-<slice-file-stem>.md` — the slice's path identifier from `docs/implementation/conventions.md` with the `/` flattened to `-`. For slice `M01/02-drizzle-schema` the file is `.impl-plans/M01-02-drizzle-schema.md`.

The fenced block is the plan's full structure — its sections and their order. `SKILL.md` is the craft guidance for filling it in: file decomposition, task right-sizing, the per-task format, and no placeholders.

```markdown
# [Slice name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the executor named in this plan's Recommended Executor section — aventuras-subagent-driven-development or aventuras-executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking; a dispatched worker tracks progress in its ledger instead and never edits this file.

Slice: [Slice N.M](../docs/implementation/milestones/NN-name/slices/NN-name.md)
Milestone: [Milestone N](../docs/implementation/milestones/NN-name/milestone.md)

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about the approach]

**Tech Stack:** [Key libraries or tools this slice uses or introduces]

## Execution gate

`none` — or a condition that must hold before execution may start, such as "Slice 1.1 merged". A plan can be complete and approved while an execution gate is still open; the executor honors the gate and waits.

[When the slice is too big for one PR (CodeRabbit reviews at most 100 non-docs files), split it here by module layer: "PR 1 = Tasks 1–N, PR 2 = Tasks N+1–M on PR 1's branch, …". Each PR's last task runs the full local gates.]

## Decisions

Carried from the aventuras-plan-slice session that preceded this plan.
Decisions that deviate from the slice brief, constrain a future slice, or
pick a non-obvious route are promoted to the slice doc's Implementation
notes when the branch is finished (this plan is git-ignored).

### Developer decisions

- **Decision:** … **Chosen:** … **Rationale:** …

### Implementer choices

- **Choice:** … **Default:** … **Rationale:** …

### Monitor during work

- **Risk:** … **Signal:** … **Response:** …

## Global Constraints

[The requirements from canon and the slice doc that bind every task — version floors, dependency limits, naming and copy rules, platform requirements, exact values — one line each, copied verbatim with the doc they come from. Every task's requirements implicitly include this section; the executor pastes it into every implementer and task-reviewer dispatch. `none` if there are none.]

## Review Focus

[The five input classes or failure modes the slice doc and canon imply but no task's tests exercise that are most likely to bite a person using this software — one line each, naming the input or condition and the behavior a reasonable person would expect, most likely first. The slice doc says what the software must do, not everything it will meet, and its silence on an input is not permission for that input to break the program. Write the list here, once, with the slice doc in front of you (at the skeleton stage in a batched plan). Then, for each line, add the test that pins it to the task that owns the code: to its Scope in a skeleton entry, to its steps otherwise. The executor passes this section to the final review and to aventuras-slice-review. An empty section means you checked and found none.]

---

### Task 1: [Component name]

**Model:** cheap | standard | capable — <why>
**Verification:** automated | review — <why>
**Canon:** [`docs/<area>/<doc>.md → <Section>`](../docs/<area>/<doc>.md#<section>) — <what this task implements from it>

[One `### Task N` per task — the Model, Verification, Canon and Depends on lines, a Files block, an Interface block, then the steps, exactly as the Task Structure section of SKILL.md specifies. Repeat for every task. A plan of more than five tasks holds skeleton entries here first, then the Writer batches line (SKILL.md → Batched writing).]

---

## Evidence Matrix

One row per slice acceptance criterion. Name the exact command or manual check — never a generic "run tests".

| Acceptance criterion           | Evidence type                                                            | Command / check                        |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------- |
| [criterion from the slice doc] | automated / typecheck / lint / Storybook / platform smoke / manual / doc | `pnpm test:run path/to/file.test.ts`   |

## Skill Plan

Which skills the executor should reach for, and which were considered and ruled out.

### Recommended during execution

- **Skill:** … **Trigger point:** … **Why:** … **May skip if:** …

### Not needed

- **Skill:** … **Reason:** …

## Recommended Executor

Filled in at the Execution Handoff step. The developer makes the final call; this records the recommendation so it survives into a later session.

- **Recommended:** aventuras-subagent-driven-development | aventuras-executing-plans
- **Reason:** …
```

Keep the plan brief — add detail where execution would otherwise have to guess, and omit research transcript and redundant slice-doc prose.
