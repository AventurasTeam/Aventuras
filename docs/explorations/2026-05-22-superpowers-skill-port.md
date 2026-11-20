# Superpowers skill port

Status: implemented. The `aventuras-*` skill workflow described here
lives under `.agents/skills/`. This record captures the decision and
the customizations applied.

Supersedes
[2026-05-21 AI-driven development workflow](./2026-05-21-ai-driven-development-workflow.md):
same problem, different approach. The earlier exploration recommended
hand-rolling project-specific slice skills; this one ports an existing
battle-tested skill set instead.

## Reader and action

Reader: the project owner and returning AI collaborators.

After reading, the reader should understand which skills now drive
slice implementation, where they came from, and what changed from
upstream.

## Decision

Port the [Superpowers](https://github.com/obra/superpowers) skill set
verbatim into `.agents/skills/` as the `aventuras-*` namespace, with
surgical customization, as the repeatable execution layer between an
approved slice doc and a finished PR.

The first attempt (2026-05-21) hand-rolled `aventuras-slice-plan`,
`-execute`, `-execute-subagents`, and `-finish`. Those drafts were
discarded: the hand-rolled restructuring lost the behavior-shaping
discipline — rationalization tables, red-flag lists, iron laws,
two-stage review — that Superpowers has tuned against real agent
behavior. Rather than re-derive that discipline, port it and adapt.

## What was ported

Thirteen skills, each prefixed `aventuras-`, committed under
`.agents/skills/`:

- Workflow: brainstorming, writing-plans, using-git-worktrees,
  subagent-driven-development, executing-plans, requesting-code-review,
  finishing-a-development-branch.
- Discipline: test-driven-development, verification-before-completion,
  systematic-debugging, receiving-code-review.
- Parallelism and meta: dispatching-parallel-agents, writing-skills.

The workflow chain: `aventuras-brainstorming` (iron out a slice's open
questions), then `aventuras-writing-plans` (write the `.impl-plans/`
plan), then `aventuras-using-git-worktrees`, then
`aventuras-subagent-driven-development` or `aventuras-executing-plans`,
then `aventuras-requesting-code-review`, then
`aventuras-finishing-a-development-branch` — with TDD, debugging, and
verification as discipline skills used throughout.

Attribution for the MIT-licensed source is in
`.agents/skills/NOTICE-superpowers.md`, with a provenance line in each
ported `SKILL.md`.

## Decisions applied

- **Verbatim baseline.** Superpowers skill text is kept as-is; the
  port enhances rather than rewrites. Only two skills are materially
  customized — see brainstorming and TDD below.
- **Namespace.** Every ported skill is renamed `aventuras-*`;
  cross-references are renamed to match.
- **Harness-agnostic.** Claude-Code-specific tool names — the Task
  tool, the todo-list tool, the `general-purpose` subagent type — are
  made generic. These skills run on any harness that reads
  `.agents/skills/`.
- **No bootstrap.** Superpowers' `using-superpowers` session-start
  gate is not ported; skills trigger on their description fields.
- **Overlapping skills coexist.** The existing `debug-like-expert`
  and `skill-creator` are kept alongside
  `aventuras-systematic-debugging` and `aventuras-writing-skills`;
  they serve different niches.
- **brainstorming retargeted.** `aventuras-brainstorming` no longer
  fleshes ideas into designs. It takes an approved slice doc, irons
  out open implementation questions with the developer (using the
  `conventions.md` question taxonomy), and hands off to
  `aventuras-writing-plans`. Planning and plan-writing stay two
  skills.
- **TDD calibrated.** `aventuras-test-driven-development` scopes its
  iron law to behavior-bearing code. Generated files, config-only
  changes, scaffolding, and visual polish are a closed list of
  carve-outs, matching `docs/implementation/conventions.md`.
- **Canonical-spec changes are gated.** When a slice needs a real
  canonical spec decision, `aventuras-brainstorming` offers the
  `aventuras-design` route to the developer; it never invokes the
  design workflow or edits a canonical doc itself.
- **Plan template salvaged from attempt 1.** The discarded first
  attempt's execution-plan template — Evidence Matrix, Decisions
  block, Skill Plan, Execution gate — was adapted into a `references/`
  template under `aventuras-writing-plans`, giving the plan a
  project-shaped output format superpowers' `writing-plans` lacks. The
  attempt's heavier readiness state machine was deliberately not
  taken.

## Relationship to existing skills

Unchanged: `aventuras-design` (canonical design and docs-integration
gate), `aventuras-doc-audit`, `aventuras-drift-check`. These cover
design and doc health — a different axis from the implementation
pipeline. `aventuras-brainstorming` is implementation planning, not
design; a slice that needs a spec decision is handed back to
`aventuras-design`.

## Not done now

- No `aventuras-slice-author` or milestone-authoring skill.
  Milestone 1 is already authored; milestone authoring stays
  owner-led.
- `AGENTS.md` is not expanded. It stays the project constitution; the
  skills carry procedure.
- No project-scoped custom agents; explicit subagent prompting via the
  ported skills is enough for now.

## Open questions

- Pilot slice: Slice 1.1 is process-heavy and low-code; Slice 1.2 is
  the first real code, migration, and cross-platform stress test.

## Resync to v7.0.2 (2026-11-20)

Upstream had reached v7.0.2. Its lessons came over in three PRs, as
surgical edits to the port above:

- #762: bug fixes (worktree cleanup, `find-polluter.sh`, a secret the
  debugging example echoed), every `SKILL.md` under the 20,000-character
  compaction cut, and the `pnpm lint:skills` gate.
  `aventuras-writing-skills` was re-ported whole.
- #763: Global Constraints and Review Focus in plans, task right-sizing,
  no builds or tests while a plan is written, `writing-good-tests.md`
  in place of `testing-anti-patterns.md`, and implementers run the unit
  project before committing.
- #764: one task reviewer per task in place of the spec and
  code-quality pair, a fix loop capped at five rounds with scoped
  re-reviews, disputed findings taken to the developer, a ledger kept
  in every run with `settled:` entries, implementer reports in files,
  and no agent dispatches subagents.

Two upstream changes were evaluated in blind runs and settled
differently, with the evidence in the PR descriptions:

- Lean plans (v6.4.2), which leave function bodies to the implementer,
  were not adopted: they lost two of ten prevented defects on the M4.2b
  replay and cost more to write (#763).
- The merged task reviewer was adopted although its defect score came
  in 1.3 points under the pair's against a 1-point bar: the gap is
  inside run-to-run noise, and it costs 34% less per task (#764).

Kept on purpose, where upstream differs: complete code in plans, the
reviewers' mutation check, the optional independent plan review, and
TDD's "Why Order Matters".
