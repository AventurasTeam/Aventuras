---
name: aventuras-slice-plan
description: >-
  Plan implementation for an Aventuras slice before code changes. Use
  when the user asks to plan, prepare, or turn a slice such as
  "Slice 1.2" or "M01/02-drizzle-schema" into an approved execution
  plan. Reads the milestone, slice doc, required anchors, followups,
  and relevant code; resolves open questions with the developer;
  writes the full plan to `.impl-plans/`; does not edit runtime code.
---

# Aventuras Slice Planning

Turn one approved Aventuras slice doc into a developer-approved
execution plan under `.impl-plans/`. This is a planning skill, not an
execution skill. The output is a plan that a later implementation
agent can follow with much less discretion.

## Hard Gates

- Do not edit runtime code.
- Do not edit canonical specs.
- Do not put full execution plans in `docs/`.
- Do not silently decide developer-owned questions.
- Do not produce an approved plan with unresolved blockers.
- Do not add task checklists to slice docs.
- Do not invoke `aventuras-design` from this skill; a `needs-design`
  state is handed back to the developer.
- You may propose a brief `Implementation notes` addition to a slice
  doc only for persistent rationale and only with user approval.

## Direct External Skills

Use other skills deliberately, only when their narrow condition appears:

- Use `design-an-interface` when planning exposes a load-bearing
  module/API/interface boundary whose shape is not obvious. Capture the
  chosen shape in the `.impl-plans/` plan. This is interface-level
  design and is distinct from `aventuras-design`, which owns canonical
  product/architecture specs (see the Readiness Gate).
- Use `debug-like-expert` when planning hits a blocker,
  contradiction, or unexplained failure that needs evidence and
  hypotheses. Keep it read-only and return findings to the plan.
- Use the project's current-documentation tooling (Context7 MCP, per
  the repo convention) when the slice depends on current external
  library, SDK, or API behavior.
- Use domain skills directly when the slice clearly falls into that
  domain, such as `typescript-advanced-types`,
  `react-state-management`, `vercel-react-best-practices`,
  `vercel-react-native-skills`, `accessibility`, or `api-design`.

The plan must include a `Skill Plan` section listing recommended
execution skills and skills considered but not needed. Skills used
during planning are not recorded in the plan; their output (an
interface shape, a debugging finding) is folded into the relevant
plan section instead.

## Built-In Planning Discipline

The following rules are baked into this skill. Do not invoke other
planning skills to get them.

### Plan For A Low-Context Executor

Write the plan for an implementation agent that has not been in the
planning conversation. The executor should be able to read the slice
doc, the plan, and the named source files and know what to do next.

Include enough detail to prevent architectural invention during
execution. Do not include research transcript, redundant slice-doc
prose, or long code samples unless the executor would otherwise guess.

### Batch Work By Risk And Verification Boundary

Group task clusters so each one can be verified independently. Put
uncertainty-retiring work early: module seams, migrations, platform
packaging, integration harnesses, and any behavior that could invalidate
later assumptions.

Avoid a plan that stacks several risky changes before the first
verification point. If a cluster is too broad to verify cleanly, split
it.

### Map Evidence Before Work Starts

Every acceptance criterion needs an evidence row before execution:

- automated test when behavior can be pinned through a public interface
- typecheck or lint when the criterion is about static guarantees
- Storybook story or visual check for component/UI states
- platform smoke for Electron, Android, or web behavior
- doc lint for documentation changes
- manual check only when automation would be disproportionate

Avoid generic verification footers like "run tests." Name the exact
command or manual check and what passing evidence means.

### Prefer Public-Interface Tests

For behavior-bearing modules, plan tests through public module
interfaces and observable behavior. Do not plan tests that mock internal
helpers or assert private state. Test-first/red-green-refactor is
recommended when the behavior has a clear contract; it is optional for
generated files, config-only changes, temporary scaffolding, or visual
polish where another evidence form is stronger.

### Use Subagents Sparingly

Use read-only subagents for independent codebase mapping, official-docs
research, or plan validation when a slice is broad enough to benefit.
Brief each subagent with a narrow question and expected output.

Do not spawn subagents by default. Do not assign editing workers during
planning. If the plan recommends editing workers for execution, define
their file/module ownership and what they must not touch.

### Validate The Plan Like A Review

Before asking for approval, review the plan for:

- correctness risks and missing edge cases
- missing tests or weak evidence
- scope creep across Scope: out
- ambiguous ownership or file boundaries
- over-large task clusters
- domain skills omitted or overused

Report concerns in the plan instead of hiding them. If a concern changes
the implementation route, ask the developer before approval.

### Stop Rather Than Guess

If planning hits a contradiction, blocker, broken required-reading
anchor, unfalsifiable verification claim, or canonical design
uncertainty, stop and classify it. Gather evidence and propose the next
action. Do not turn uncertainty into an implicit implementation choice.

## Workflow

### 1. Orient

Read in parallel where possible:

- `AGENTS.md`
- `docs/implementation/conventions.md`
- parent milestone doc
- target slice doc
- `docs/followups.md`
- `.claude/rules/docs.md`
- `.claude/rules/code.md` if source files are likely involved
- `git status --short`

Extract the slice identity, path, goal, dependencies, blockers, scope
boundaries, required reading anchors, acceptance criteria, tests, open
questions, and current worktree state.

### 2. Required Reading

Resolve every Required reading link: read the file, locate the heading
its anchor slug points to, and read that section — not just the file
as a whole. Summarize only the parts that affect implementation
planning.

Broken anchors are caught by CI and should be virtually non-existent.
If one does slip through, or the slice cites stale docs, stop and
report that the slice brief needs amendment before planning can
finish.

### 3. Codebase Recon

Map existing patterns before planning changes:

- Use `rg` and targeted reads for modules, components, tests, scripts,
  and config touched by the slice.
- Prefer local patterns over external generic advice.
- For broad slices, spawn read-only mapper subagents with narrow,
  non-overlapping questions.
- Do not assign editing work during planning.

### 4. Readiness Gate

Classify readiness:

- `ready`: all blocking questions resolved; the plan can reach
  `approved`.
- `needs-developer-decision`: user must choose between viable options
  before the plan can be approved.
- `needs-design`: canonical product/architecture uncertainty — the
  spec itself is unsettled.
- `needs-slice-amendment`: slice doc is stale, contradictory, too
  large, or missing critical scope.
- `blocked`: dependency slice, toolchain, or environmental blocker.

Always write a plan file. Readiness sets how far it can go:

- `ready`, or `needs-developer-decision` once the decisions are
  answered — the plan can be completed and proposed for approval.
- Any other state — write the plan as `Status: draft`, record the
  specific obstacle and the recommended next action, then hand back
  to the developer. Do not advance such a plan to `approved`.

This skill never resolves a non-`ready` state itself: it does not
invoke `aventuras-design`, does not amend the slice doc, and does not
clear a blocker. It records what is needed and stops. The developer
runs the design session, amends the slice, or unblocks, then re-runs
planning.

### 5. Question Protocol

Ask only questions that change the implementation plan. Group findings
before asking:

- Developer decisions: must answer before plan finalization.
- Implementer choices: agent may choose, but should state the default.
- Monitor during work: known risk, no decision yet.
- Blockers: planning cannot finish.

These four categories are defined in
`docs/implementation/conventions.md` → Slice planning; that doc is the
source of truth and this skill follows it if it changes.

Prefer a small numbered decision list over a long interrogation. Give a
recommended default when evidence supports one.

### 6. Draft The Plan

Write to `.impl-plans/<milestone>-<slice-file-stem>.md` — the slice's
path identifier from `docs/implementation/conventions.md` → Identifier
convention with the `/` flattened to `-` (a filename cannot contain
`/`). For path identifier `M01/02-drizzle-schema` the file is
`.impl-plans/M01-02-drizzle-schema.md`. Inside the plan, the H1 title
and prose may use either register per that convention.

`.impl-plans/` is git-ignored; the plan, its `Status`, and its
approval are local working state between the developer and the
executing agent, not a durable project record.

Use the template in `references/execution-plan-template.md`. Keep the
plan concise enough to execute. It should be more detailed than the
slice doc, but not a transcript of research.

### 7. Review Before Approval

Before marking the plan approved:

- Re-read the slice's Scope: out and confirm the plan does not cross
  it.
- Confirm every open question is resolved, explicitly delegated to the
  implementer, or listed as a monitor item.
- Confirm every acceptance criterion has evidence.
- Confirm verification commands exist and are repo-valid.
- Confirm the Skill Plan is plausible and not bloated.
- For complex plans, optionally spawn a read-only validation subagent
  to check file references, scope, and test strategy.

Then present the plan path and a short review prompt:

```text
Plan written to `.impl-plans/M01-02-drizzle-schema.md`.
Please review the decisions, task clusters, evidence matrix, skill plan,
and stop conditions. Execution should not begin until you approve this plan.
```

Update `Status: approved` only after explicit developer approval.

## Stop Conditions

Stop and ask or redirect when:

- The slice is too large for one PR.
- Required reading contradicts the slice doc.
- The plan would require changing canonical specs.
- A developer-decision item remains unanswered.
- Verification cannot be made falsifiable.
- Tooling or dependency state prevents implementation.
- The implementation route would cross Scope: out.

## Success Criteria

- The plan file exists in `.impl-plans/`, named per Draft The Plan.
- The plan names source milestone and slice docs.
- Required reading has been checked at named anchors.
- Developer decisions are resolved or the plan remains draft.
- Every acceptance criterion maps to evidence.
- Skill usage is classified as recommended for execution or not
  needed.
- Stop conditions are explicit.
- No runtime code or canonical docs were edited.
