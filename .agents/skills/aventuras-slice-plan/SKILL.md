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
- Do not mark a plan `approved` unless its state is `ready` (or a
  fully answered `needs-developer-decision`); an execution gate is
  allowed, an unresolved planning blocker is not.
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
it. Declare each cluster's ordering dependencies on other clusters;
clusters with no dependency edge between them are parallelizable, which
is the signal the execution skill needs to dispatch work.

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

Do not spawn subagents by default. Do not assign or define editing
workers — worker count and file ownership are the execution skill's
concern, not the plan's. The plan stops at the cluster decomposition
(see Batch Work By Risk And Verification Boundary): the execution skill
owns the worker role and maps clusters onto workers, sized to its own
harness, at run time.

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

Classify the slice into one readiness state. Every state has a
resolution path — a non-`ready` plan is a precise problem statement,
not a dead end. Always write the plan file regardless of state.

- `ready` — nothing blocks a correct, approvable plan.
- `needs-developer-decision` — a choice within the slice's
  implementation latitude is open; reaches `approved` once answered.
- `needs-design` — a load-bearing canonical spec decision is
  unsettled; `draft` only.
- `needs-slice-amendment` — the slice doc is stale, contradictory,
  mis-sized, or missing scope; `draft` only.
- `blocked` — a dependency slice, toolchain, or environment stands in
  the way; whether the plan can still reach `approved` depends on
  which.

Separate the two gates. The **planning gate** asks whether a correct,
complete plan can be written. The **execution gate** asks whether
execution can start. A plan can pass the first and fail the second —
a slice planned against a pinned contract whose dependency has not
merged is complete and approvable, with execution gated on the merge.

A non-`ready` plan records a `Resolution Path`: the obstacle, the
resolution owner, the concrete action, and how work resumes. Two
resumption routes:

- **Re-plan** — re-run this skill against the corrected input, when
  the resolution may move the implementation route.
- **Clear the gate** — flip `Status` to `approved` without re-running,
  only when the plan was already written against the correct
  understanding and the resolution merely makes an input agree with
  it.

Resolution path per state:

- `needs-developer-decision` — surface the decisions via the Question
  Protocol (Step 5) with recommended defaults; resolved in-session
  when the developer answers. If the developer is unavailable, the
  draft records each decision and its default, and resumes when
  answered.
- `needs-design` — the draft records the exact canonical question,
  the options, and why it is a spec decision rather than an
  implementation choice. Owner: the developer, via an
  `aventuras-design` session — this skill does not invoke it. That
  session settles the canonical doc; then re-plan, since a spec
  change can move the route.
- `needs-slice-amendment` — the draft records a section-by-section
  punch list of the stale slice-doc text and what it should become,
  plus any milestone-doc knock-on. Owner: the developer (slice docs
  are owner-authored). After amendment, clear the gate if the plan
  already assumed the corrected slice; re-plan if the amendment
  diverges from what the plan assumed.
- `blocked` — a dependency slice not yet merged does not block
  planning when the milestone pins the contract (doc-as-contract):
  plan against that contract, reach `approved`, and record an
  execution gate. With no pinned contract there is no fixed boundary
  — the developer lands the dependency or pins the contract, then
  re-plan. A toolchain or environment fault that blocks verifying the
  plan's commands keeps the plan `draft` until fixed; one that only
  blocks running execution leaves the plan approvable with an
  execution gate.

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

- Confirm the state is `ready` (or a fully answered
  `needs-developer-decision`); any other state stays `draft`.
- Confirm the plan does not contradict its slice doc or cited
  canonical specs — a contradiction is `needs-slice-amendment` or
  `needs-design`, not an approvable plan.
- Re-read the slice's Scope: out and confirm the plan does not cross
  it.
- Confirm every open question is resolved, explicitly delegated to the
  implementer, or listed as a monitor item.
- Confirm every acceptance criterion has evidence.
- Confirm verification commands exist and are repo-valid.
- Confirm the Skill Plan is plausible and not bloated.
- An approved plan may still carry an execution gate (e.g. a
  dependency awaiting merge); state the gate so the executor waits.
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

These conditions mean the plan cannot reach `approved` on this pass.
Do not push past them — classify the readiness state, write the draft
with its Resolution Path (Step 4), and hand back.

- Slice too large for one PR → `needs-slice-amendment`.
- Required reading contradicts the slice doc → `needs-slice-amendment`.
- The route would require changing a canonical spec → `needs-design`.
- A developer-decision item is unanswered → `needs-developer-decision`.
- Verification cannot be made falsifiable → fix the criterion, or
  `needs-slice-amendment` if the acceptance criterion itself is wrong.
- Tooling or dependency state prevents planning or execution →
  `blocked`.
- The route would cross Scope: out → re-plan within scope, or
  `needs-slice-amendment` if the slice boundary itself is wrong.

## Success Criteria

- The plan file exists in `.impl-plans/`, named per Draft The Plan.
- The plan names source milestone and slice docs.
- Required reading has been checked at named anchors.
- Developer decisions are resolved or the plan remains draft.
- A non-`ready` plan carries a Resolution Path with obstacle, owner,
  action, and resumption route.
- Every acceptance criterion maps to evidence.
- Skill usage is classified as recommended for execution or not
  needed.
- Stop conditions are explicit.
- No runtime code or canonical docs were edited.
