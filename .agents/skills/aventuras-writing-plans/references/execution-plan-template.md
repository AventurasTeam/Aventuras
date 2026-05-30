# Execution Plan Template

Copy the fenced block below into `.impl-plans/<milestone>-<slice-file-stem>.md` — the slice's path identifier from `docs/implementation/conventions.md` with the `/` flattened to `-`. For slice `M01/02-drizzle-schema` the file is `.impl-plans/M01-02-drizzle-schema.md`.

The fenced block is the plan's full structure — its sections and their order. `SKILL.md` is the craft guidance for filling it in: file decomposition, task granularity, the per-task format, and no placeholders.

```markdown
# [Slice name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the executor named in this plan's Recommended Executor section — aventuras-subagent-driven-development or aventuras-executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

Slice: [Slice N.M](../docs/implementation/milestones/NN-name/slices/NN-name.md)
Milestone: [Milestone N](../docs/implementation/milestones/NN-name/milestone.md)

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about the approach]

**Tech Stack:** [Key libraries or tools this slice uses or introduces]

## Execution gate

`none` — or a condition that must hold before execution may start, such as "Slice 1.1 merged". A plan can be complete and approved while an execution gate is still open; the executor honors the gate and waits.

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

---

### Task 1: [Component name]

**Model:** cheap | standard | capable — <why>
**Verification:** automated | review — <why>

[One `### Task N` per task — the Model and Verification tier lines, a Files block, then bite-sized steps, exactly as the Task Structure section of SKILL.md specifies. Repeat for every task.]

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
