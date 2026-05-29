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

The input is one slice doc plus the open questions resolved in `aventuras-brainstorming`. Read the slice doc, its parent milestone, and the decisions carried over from brainstorming.

## Scope Check

A slice is a PR-sized unit — one slice, one plan. If the slice turns out too large for one PR, `aventuras-brainstorming` should have flagged it for a split; if it slipped through, stop and recommend a slice split rather than planning an oversized slice.

## Plan Structure

Write the plan into a file created from `references/execution-plan-template.md`. That template is the plan's structure — its sections, in this order, are mandatory:

- **Header** — title, the agentic-workers sub-skill line, `Slice:` / `Milestone:` links, Goal, Architecture, Tech Stack.
- **Execution gate** — a condition that must hold before execution may start, or `none`.
- **Decisions** — developer decisions, implementer choices, and monitor-during-work items carried from `aventuras-brainstorming`.
- **Tasks** — one `### Task N` per task; see Task Structure below.
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

## Task Structure

Each entry in the plan's Tasks section follows this format:

````markdown
### Task N: [Component Name]

**Model:** cheap | standard | capable — <one-line why>
**Verification:** automated | review — <one-line why>

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

## Self-Review

After writing the complete plan, look at the slice doc with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Slice coverage:** Skim each requirement in the slice doc — Goal, Scope: in, Acceptance criteria. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Evidence coverage:** Does every slice acceptance criterion have an Evidence Matrix row naming a real command or check — not a generic "run tests"?

**5. Tier assignment:** Does every task carry a Model and a Verification tier with a one-line reason? An `automated` task must name the commands that fully cover it; if it can't, it's `review`.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a slice requirement with no task, add the task.

## Execution Handoff

After saving the plan, recommend an executor — then let the developer choose.

Assess the plan: a small, single-task, or tightly-coupled plan whose tasks must stay coherent suits inline execution; a larger, multi-task plan where fresh context per task and review between tasks de-risk the work suits subagent-driven execution. Record this recommendation and a one-line reason in the plan's Recommended Executor section.

Then present both options with the recommendation:

**"Plan complete and saved to `.impl-plans/<filename>.md`. Two execution options:**

**1. Subagent-Driven** — a fresh subagent per task, two-stage review on review-tier tasks, fast iteration.

**2. Inline Execution** — tasks executed in this session, batched with review checkpoints.

**I recommend [option] — [reason]. Which would you like?"**

Wait for the developer's answer; do not invoke an executor before they choose. Once they choose:

- **Subagent-Driven** → **REQUIRED SUB-SKILL:** Use aventuras-subagent-driven-development
- **Inline Execution** → **REQUIRED SUB-SKILL:** Use aventuras-executing-plans
