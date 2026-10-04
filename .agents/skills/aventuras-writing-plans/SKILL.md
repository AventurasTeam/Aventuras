---
name: aventuras-writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

<!-- Adapted from Superpowers (https://github.com/obra/superpowers), MIT-licensed. See .agents/skills/NOTICE-superpowers.md. -->

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the aventuras-writing-plans skill to create the implementation plan."

**Context:** If working in an isolated worktree, it should have been created via the `aventuras-using-git-worktrees` skill at execution time.

**Save plans to:** `.impl-plans/<milestone>-<slice-stem>.md` — the slice's path identifier from `docs/implementation/conventions.md` with the `/` flattened to `-`. For slice `M01/02-drizzle-schema` the file is `.impl-plans/M01-02-drizzle-schema.md`.

- `.impl-plans/` is git-ignored. The plan is run-specific working state shared between the developer and the executing agent — not project documentation.

## Project code conventions

For code work, read [`docs/code-conventions.md`](../../../docs/code-conventions.md) — module structure (`lib/*` public-API rule), state placement, action layer, component taxonomy, testing — and check the [lessons-learned index](../../../docs/implementation/lessons-learned/README.md) before touching the substrate an entry references.

## Input

The input is one slice doc plus the open questions resolved in `aventuras-plan-slice`. Read the slice doc, its parent milestone, and the decisions carried over from brainstorming.

## Scope Check

A slice is a PR-sized unit — one slice, one plan. If the slice turns out too large for one PR, `aventuras-plan-slice` should have flagged it for a split; if it slipped through, stop and recommend a slice split rather than planning an oversized slice.

## Plan Structure

Write the plan into a file created from `references/execution-plan-template.md`. That template is the plan's structure — its sections, in this order, are mandatory:

- **Header** — title, the agentic-workers sub-skill line, `Slice:` / `Milestone:` links, Goal, Architecture, Tech Stack.
- **Execution gate** — a condition that must hold before execution may start, or `none`.
- **Decisions** — developer decisions, implementer choices, and monitor-during-work items carried from `aventuras-plan-slice`. These are the upstream source for the slice doc's **Implementation notes**: any decision that deviates from the slice brief, constrains a future slice, or picks a non-obvious route is promoted there when the branch is finished. This plan lives in git-ignored `.impl-plans/` and is ephemeral — the slice doc is the durable record, so nothing notable should die with the plan.
- **Tasks** — one `### Task N` per task; see Task Structure below. A plan of more than five tasks holds skeleton entries here first, then a Writer batches line; see Batched writing.
- **Evidence Matrix** — one row per slice acceptance criterion.
- **Skill Plan** — domain skills the executor should reach for.
- **Recommended Executor** — filled at the Execution Handoff step.

The template is the skeleton. The rest of this skill is how to fill it well — decomposing files (File Structure), sizing tasks (Bite-Sized Task Granularity), writing each task (Task Structure), and keeping every step concrete (No Placeholders).

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**

- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Per-task tiers: model and verification

Every task carries two tiers the executor honors. Assign them now — you see all the tasks and their nature at once, so the call is cheaper and more honest here than mid-execution.

**Model** — the least powerful model that can do the task (mirrors the subagent skill's Model Selection):

- `cheap` — mechanical: 1-2 files, complete spec, no design judgment. Most well-specified tasks.
- `standard` — integration: multiple files, pattern-matching, debugging.
- `capable` — design judgment or broad codebase understanding.

**Verification** — how the task's acceptance is confirmed:

- `automated` — fully covered by deterministic gates (typecheck, lint, existing tests, a completeness grep). The executor runs the named commands and reports the evidence; the implementer's self-review covers spec-compliance. No reviewer subagents. Eligible only when no behavioral judgment is needed — and any runtime-only risk (a change that passes the gates but could behave differently at runtime, e.g. platform variants or timing) is named as a smoke / monitor, not waved through.
- `review` — anything with new logic, behavioral assertions, or an ambiguous spec. Gets the full two-stage review (spec compliance, then code quality) in the subagent skill.

When unsure, pick `review` and `standard` — over-verifying is cheaper than a silent miss. The developer sees both tiers in the plan and can push any task up before execution starts.

## Canon references

Every task names the canon it implements on a **Canon:** line: one or more doc sections, as links with anchors, each with a few words on what it governs for this task. The executor pastes the task into the implementer's prompt, so this line is how the implementer knows where to look. Name the section, not the whole doc. Where the task departs from canon on purpose, say so on the line and point to the Decision that records why.

## Task Structure

Each entry in the plan's Tasks section follows this format:

````markdown
### Task N: [Component Name]

**Model:** cheap | standard | capable — <one-line why>
**Verification:** automated | review — <one-line why>
**Canon:** [`docs/<area>/<doc>.md → <Section>`](../docs/<area>/<doc>.md#<section>) — <what this task implements from it>

**Files:**

- Create: `lib/feature/thing.ts`
- Modify: `lib/feature/existing.ts:123-145`
- Test: `lib/feature/thing.test.ts` (colocated with the module)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'

import { doThing } from './thing'

describe('doThing', () => {
  it('returns the expected value for a known input', () => {
    expect(doThing(input)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run lib/feature/thing.test.ts`
Expected: FAIL — `doThing is not a function` (or similar)

- [ ] **Step 3: Write minimal implementation**

```typescript
export function doThing(input: Input): Result {
  return expected
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run lib/feature/thing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/feature/thing.ts lib/feature/thing.test.ts
git commit -m "feat: add doThing"
```
````

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Remember

- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Batched writing

A plan of more than five tasks is written in stages, so each task gets a writer's whole attention. Written in one pass, a long plan's tasks come out thin: in an evaluation on the M4.2b plan, tasks written whole prevented none of 19 defects found later, and tasks written four at a time from a skeleton prevented 10. Up to five tasks, write the plan whole as the sections above describe.

**1. Skeleton.** Write the plan file with every section, but each task as a skeleton entry, then the Writer batches line. A writer later turns each entry into the full task, seeing only the skeleton, the repository and canon, so the entry must decide everything that crosses tasks.

````markdown
### Task N: [Component Name]

**Model:** cheap | standard | capable — <one-line why>
**Verification:** automated | review — <one-line why>
**Canon:** [`docs/<area>/<doc>.md → <Section>`](../docs/<area>/<doc>.md#<section>) — <what this task implements from it>
**Depends on:** Task a (<what it uses from it>), … — or `none`

**Scope:** <what the task delivers and how its acceptance is shown: behaviour, edge cases and refusals that other tasks or the slice's acceptance criteria rely on. A paragraph, not steps.>

**Files:**

- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts`
- Test: `exact/path/to/file.test.ts`

**Interface:**

```ts
// The exported declarations this task adds or changes: exact names, signatures, types
// with their fields, constants with their values, component props.
```

**Shared resources:** <migration number, i18n namespace and keys, shared fixtures, barrel lines> — or `none`
````

The interfaces are the contract between writers working at the same time:

- Write them from the code at this commit. Every existing function, type or table an interface names or calls must exist with that shape: read it, don't recall it.
- Put cross-task behaviour in the owning task's Scope, not only in a type: who validates an input, who takes which lock, what a function returns when it refuses, what runs inside a transaction. A writer of a dependent task sees only the interface and the Scope.
- Name every shared resource once, in the task that owns it, so two writers never pick the same migration number or i18n key.

After the task list, add a **Writer batches** line: about four consecutive tasks per batch, tasks that edit the same file in one batch where you can, and for each batch the files it shares with other batches.

**2. Review and approval.** Run the Self-Review on the skeleton, then offer the Independent review on it: the reviewer checks the contract the writers build on, which is where a batched plan's cross-task errors live. Then show the developer the skeleton (the task list with tiers, and the batches) and wait for their approval. Fixing an interface now costs an edit; after the writers it costs a batch.

**3. Writers.** Dispatch the `aventuras-plan-writer` agent (`.claude/agents/aventuras-plan-writer.md`: Opus, effort `xhigh`) once per batch, with [`plan-writer-prompt.md`](plan-writer-prompt.md). Writers run three at a time by default: before dispatching, tell the developer the number of batches and the concurrency, and let them change it. Each writer writes its tasks to `<plan-stem>.batch-<K>.md` next to the plan and replies with a report. Without Claude Code agent definitions (another harness), dispatch a general subagent whose prompt is that definition file's body followed by the filled template.

**4. Assembly.** Handle each report the way aventuras-receiving-code-review handles review feedback: check it against the code and canon before acting. In the M4.2b evaluation about four reports in ten were not real problems.

- A real interface problem: fix the skeleton entry, and rerun every batch whose tasks use that interface.
- A writer's correction of its own task's scope: keep it if it holds, and tell the developer.
- An open cross-task question: settle it, and fix the tasks it touches, by a small edit or by rerunning the batch.

Then replace each skeleton entry in the plan with its written task, delete the batch files, and run the Self-Review's placeholder scan and type consistency check across the whole plan: tasks use each other's interfaces as declared, and a task that edits a file an earlier task changed starts from what that task leaves there.

## Self-Review

After writing the complete plan, look at the slice doc with fresh eyes and check the plan against it. In a batched plan this runs on the skeleton, and the placeholder scan and type consistency check run again after assembly (see Batched writing). This is a checklist you run yourself — not a subagent dispatch.

**1. Slice coverage:** Skim each requirement in the slice doc — Goal, Scope: in, Acceptance criteria. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Evidence coverage:** Does every slice acceptance criterion have an Evidence Matrix row naming a real command or check — not a generic "run tests"?

**5. Tier assignment:** Does every task carry a Model and a Verification tier with a one-line reason? An `automated` task must name the commands that fully cover it; if it can't, it's `review`.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a slice requirement with no task, add the task.

## Independent review

The self-review shares every blind spot of the session that wrote the plan. After it, offer the developer an independent review by a reviewer with none of this session's context. In a batched plan the review runs on the skeleton, before any writer (see Batched writing).

1. **Skip.**
2. **A fresh subagent:** a clean context, the same model family.
3. **An external agent** through an orchestrator, when the environment has one: a clean context, and it can be a different model family. With Orca, follow [`references/external-plan-review.md`](references/external-plan-review.md).

Recommend one. The external agent suits a plan that changes the schema, touches a contract another slice builds on, or runs to many tasks. The subagent suits a plan with new logic that doesn't. Skipping suits a few mechanical tasks. The developer chooses, and names the agent for the external route.

Both reviewers get [`plan-document-reviewer-prompt.md`](plan-document-reviewer-prompt.md) with its paths filled in, and nothing else from this session. They write their findings to `<plan-stem>.plan-review.md` next to the plan and never edit the plan.

**Handle the findings** the way aventuras-receiving-code-review handles review feedback: check each one against the slice doc, canon and the code before acting on it.

- A finding that holds gets fixed in the plan.
- One that doesn't gets rejected, with the evidence.
- One that challenges a recorded Decision or the slice doc goes to the developer, whichever way you lean.

Add a line under each finding in the review file saying what happened to it. Then tell the developer the verdict, what you changed, what you rejected, and any question for them, before moving on to the handoff.

## Execution Handoff

After saving the plan, recommend an executor — then let the developer choose.

Assess the plan: a small, single-task, or tightly-coupled plan whose tasks must stay coherent suits inline execution; a larger, multi-task plan where fresh context per task and review between tasks de-risk the work suits subagent-driven execution. Record this recommendation and a one-line reason in the plan's Recommended Executor section. A plan handed off to a worker always records subagent-driven (see below).

Then present the options with the recommendation:

**"Plan complete and saved to `<absolute path to the plan>`. Execution options:**

**1. Subagent-Driven** — a fresh subagent per task, two-stage review on review-tier tasks, fast iteration.

**2. Inline Execution** — tasks executed in this session, batched with review checkpoints.

**3. Hand off to a worker** — this session stops here; the plan runs unattended in another session that dispatches a worker.

**I recommend [option] — [reason]. Which would you like?"**

Wait for the developer's answer; do not invoke an executor before they choose. If they already said execution happens elsewhere, that is the answer — go straight to the hand-off without asking. Once they choose:

- **Subagent-Driven** → **REQUIRED SUB-SKILL:** Use aventuras-subagent-driven-development
- **Inline Execution** → **REQUIRED SUB-SKILL:** Use aventuras-executing-plans
- **Hand off to a worker** → invoke no executor. Record aventuras-subagent-driven-development in Recommended Executor — nobody watches a worker, and aventuras-executing-plans stops to ask a human. End the session with the line the developer passes on, verbatim:

  `Dispatch slice <milestone>/<slice-stem>: plan at <absolute path to the plan>`

  Leave the plan where it is. `.impl-plans/` is git-ignored, so a worker's new worktree has no copy; the worker, on this same machine, reads the plan by absolute path and never edits it.
