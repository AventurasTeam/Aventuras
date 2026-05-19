# Implementation conventions

How implementation work is decomposed, documented, and handed off
in this repo. The [docs subtree index](./README.md) lists what
lives here; this doc is the authoritative source for **what a
milestone is, what a slice is, what makes a slice dev-ready**, and
how implementation docs relate to the canonical specs under
[`docs/`](../README.md).

Canonical specs (`docs/data-model.md`, `docs/architecture.md`,
`docs/generation-pipeline.md`, `docs/memory/`, `docs/ui/`, etc.)
are the source of truth for **what** the system does.
Implementation docs here describe **how the work is sliced and
ordered** to build it. The two layers never duplicate each other:
canonical specs are authoritative; implementation docs paraphrase
for the reader's benefit and link back for the authoritative
version.

## Hierarchy

Three levels:

- **Milestone** — a product-progress unit. Completion means the
  app is meaningfully more capable or more architecturally complete
  than before. The _goal_ of a milestone is stable once defined; if
  the goal shifts, that's a new milestone, not an edit.
- **Slice** — a PR-sized unit of work. One slice = one PR. Slices
  within a milestone should aim to be independently mergeable where
  the dependency graph allows. Sizing rule: days, not weeks; split
  if a slice keeps stretching.
- **Task** — bite-sized work step inside a slice. Tasks live in
  the PR description (or the team's tracker), **not** in `docs/`.
  The slice doc describes what to build; the PR holds the checklist
  of how it's being built.

## Directory layout

```
docs/implementation/
├── README.md                          # index only
├── conventions.md                     # this doc
└── milestones/
    └── NN-name/
        ├── milestone.md               # milestone definition
        └── slices/
            └── NN-name.md             # one file per slice
```

- Milestone directory name: `NN-name` with two-digit zero-padded
  milestone number and a kebab-case name (e.g. `01-spine`).
- Slice filename: `NN-name.md` with two-digit zero-padded slice
  number scoped to its milestone, kebab-case name (e.g.
  `03-pipeline.md`).
- `milestone.md` is the canonical name for a milestone's
  definition file. A `README.md` may exist alongside it as the
  directory's index/meta if the milestone grows companion docs
  (exploration records, decision logs) — but the milestone
  definition itself never lives in `README.md`.

## Identifier convention

Two registers:

- **Prose / human-readable**: "Milestone 1," "Slice 1.3." Used in
  conversation, commit messages, slice doc bodies referring to
  other slices.
- **Path / file-aligned**: `M01/03-pipeline`. Used when an exact
  pointer to a file is needed in tooling or cross-doc references.

When referencing a slice in markdown, the link uses the path form
with the prose form as the link label:

```
[Slice 1.3](./slices/03-pipeline.md)
```

## Milestone doc structure

Each `milestone.md` carries the sections below in order. Omit any
that genuinely don't apply — these are templates, not ceremony.

**Goal.** One short paragraph stating what completion of this
milestone means in product or architectural terms. Stable once
written.

**Why now.** Rationale for this milestone happening when it does.
What it unlocks, what depends on it, what it de-risks.

**Narrative / overview.** A paragraph or three on **how the slices
compose** into the milestone as a whole. What changes from "before
this milestone" to "after"? Why this composition? What
cross-cutting decisions show up across slices? A reader who reads
only the narrative should understand what's being built and how
the pieces fit, without having to open every slice doc.

**Slices.** One bullet per slice with a one-line summary and a
link to its slice doc:

```
- [Slice 1.1](./slices/01-drizzle.md) — Drizzle + minimal schema + migration tooling
- [Slice 1.2](./slices/02-ai-sdk.md) — Vercel AI SDK baseline, provider abstraction stub
```

**Dependency graph.** Explicit declaration of which slices gate
which. ASCII diagram or prose, whichever is clearer for the actual
graph. "Slices are independent" is aspirational; the graph is what
is binding.

**Slice contracts.** Types, interfaces, or behavioral contracts
that span more than one slice. Pinning them here lets slices be
authored in parallel against a fixed boundary. May be empty when
sequencing dominates — see
[Sequencing vs doc-as-contract](#sequencing-vs-doc-as-contract)
below.

**Definition of done.** Verifiable pass/fail criteria for the
milestone as a whole. What must be true for the milestone to be
considered shipped.

**Open questions.** Known-unknowns at the milestone scope.
Slice-specific questions belong in the slice doc instead.

## Slice doc structure

Each slice doc carries the sections below in order. Same rule as
milestones: fill in what's useful, omit what doesn't apply.

**Metadata.** A short block at the top:

- **Milestone**: link to the parent milestone doc
- **Depends on**: list of slice IDs that must be merged before
  this slice can start, or "none"
- **Blocks**: list of slice IDs that need this one

**Goal.** One short paragraph stating what concrete artifacts this
slice delivers and why.

**Background.** Three to five sentences of orientation, scoped to
this slice, written for the executing dev. A short paraphrase of
the relevant spec context — enough to make the slice intelligible
without restating the whole canonical spec. The paraphrase is
**for orientation**; the canonical docs remain authoritative.

Keep this section thin. The shorter the paraphrase, the smaller
the drift surface when canonical specs evolve.

**Required reading.** Explicit pointers into the canonical docs
that the executing dev should read before starting. Use **named**
anchor links scoped to specific sections, not file-level links:

```
- [data-model.md → Awareness links](../../../../data-model.md#awareness-links)
- [generation-pipeline.md → Phase graph](../../../../generation-pipeline.md#phase-graph)
```

**Scope: in.** Concrete deliverables produced by this slice —
tables, types, files, components, tests. Bullets with enough
specificity that a reader can tell whether a thing is or isn't in
this slice.

**Scope: out.** Things that look related but explicitly belong to
other slices or other milestones. Naming what's _not_ in scope
often saves more review time than naming what is.

**Acceptance criteria.** Verifiable pass/fail tests for slice
completion. Specific enough that a reviewer can check them without
asking the slice author.

**Tests.** What's covered, at what level, with what tool. Vitest
unit tests on `lib/` modules, Storybook stories for new compounds,
manual smoke for cross-platform behavior. Calibrated to the
slice's risk profile — a config-only slice doesn't need full
coverage; a pipeline slice probably does.

**Open questions.** Known-unknowns the executing dev should expect
to surface during implementation. If a question turns into a
decision during implementation, the canonical doc is updated and
the slice doc is amended accordingly.

## Authorship

- **Milestone docs**: solo-authored by the project owner.
  Milestone authoring is concentrated work that doesn't
  parallelize well; returning collaborators don't need to
  participate in milestone definition.
- **Slice docs**: solo-authored, same reason. Returning
  collaborators execute against them once written. Slice docs land
  **before** the PR that implements them — the slice doc is the
  brief, the PR is the work against it.
- **Tasks (in PRs)**: filled in by the executing dev as they break
  the slice down into steps. Not in `docs/`.

## Linking discipline

Canonical specs are the source of truth for spec content.
Implementation docs (milestone narrative, slice Background) may
paraphrase or summarize for the reader's benefit but never claim
authority. When code and spec disagree, the spec wins by default —
re-open the spec decision deliberately if you think it's wrong;
don't quietly fix the code to match a different model.

Implementation docs link **into** canonical docs heavily. Canonical
docs do **not** link back to implementation — back-references from
canonical to implementation create drift, since implementation
churns while canonical specs stabilize.

### Anchor convention

Use **named** anchors, not numeric. `#awareness-links` survives
section reorganization; `#3-2` does not. Headings in canonical docs
are anchor targets — heading renames are breaking changes and
require updating inbound references in the same commit (the
project-level rule lives in
[the docs conventions](../conventions.md#cross-references)).

### Drift management

Pre-commit (lefthook → remark) validates that every anchor link
resolves. Broken anchors fail the commit, which is the feature
working as intended: it forces the author to fix the link or
update the heading, preventing silent drift.

Paraphrased text inside a Background section can still drift
semantically — the canonical doc's content evolves while the
paraphrase doesn't. Mitigation is to keep Background sections
**thin** so the drift surface stays small. If drift becomes a real
problem, add a "spec as of YYYY-MM-DD" footer to the slice doc;
don't add ceremony preemptively.

## When milestones change

The _goal_ of a milestone is stable. The _slice list_ is not —
implementation will surface that some slice is wrong, mis-sized, or
in the wrong place. When that happens, amend the milestone doc and
update slices deliberately; don't quietly diverge in code.

If the milestone _goal_ shifts (not just its decomposition),
that's a new milestone, not an edit. The old milestone stays in
place as a historical record of work that landed under it.

## Sequencing vs doc-as-contract

When two slices share a contract (types, interfaces, behavioral
boundary), there are two ways to neutralize divergence risk:

- **Sequencing**: land the first slice, fix the contract by
  implementation, then start the second. Burns parallelism in
  exchange for not having to pre-author the contract.
- **Doc-as-contract**: specify the contract in the milestone's
  **Slice contracts** section. Both slices author against a fixed
  boundary and can proceed in parallel, but the contract has to
  be written down before either starts.

Per-milestone call, not a project-wide rule. Spine-like milestones
with few slices and a small team tend toward sequencing. Later
milestones with more parallelizable surface and more contributors
active tend toward doc-as-contract.

## Don't over-formalize

The section templates above are **defaults, not requirements**.
Treat each section as "fill in if it's useful for this slice; omit
when it isn't." A trivial config-only slice doesn't need a
Dependency graph or a Background; a load-bearing pipeline slice
probably uses every section. The blueprint exists to make
dev-ready slices easy to author, not to add ceremony.
