---
summary: 'Record decisions: one ADR per decision in docs/decisions/, written in the PR that makes it. Only document what the code cannot express.'
tags: [documentation]
cross-cutting: true
---

# Record decisions as generated-index ADRs, not hand-written area docs

## Context and Problem Statement

`docs/` restated what the code says, drifted from it, and grew without structure. Agents read it, trusted it, and acted on stale content or spent time and context determining truth. How do we keep the reasoning that does not fit in a comment without keeping a second, drifting copy of the code?

## Considered Options

* ADRs with a generated index, code anchors and a validating script
* Hand-written area docs, kept as they were
* Hand-written call-graph or layering docs
* A fixed three-level depth per decision (ruling, spec, research)
* C4 or arc42
* LLM-generated context files

## Decision Outcome

Chosen option: "ADRs with a generated index, code anchors and a validating script", because it keeps only intent (conventions, conditional rules, intentional gaps and their reasons) and lets tooling check everything a check can check.

* Each decision is one MADR-style file, `docs/decisions/YYYY-MM-DD-slug.md`. The slug is its ID. The frontmatter holds a one-line `summary`, `tags` from `docs/decision-tags.yml`, `cross-cutting`, `active` and `superseded-by`. State is derived from the last two; there is no status field.
* `docs/README.md` and the cross-cutting block in `AGENTS.md` are generated from frontmatter by `npm run docs:gen` and never edited by hand.
* An `ADR(slug)` comment ties a decision to the code it governs. Anchors to a superseded, retired or missing ADR fail the check.
* Raw material goes in `docs/evidence/` and must be linked from an ADR, directly or through its folder.
* `docs/ARCHITECTURE.md` is the one human-owned map: areas, boundaries and invariants, revisited a few times a year.
* `AGENTS.md` is the only agent instruction file. Nothing vendor-specific is committed.
* `scripts/docs-check.ts` validates all of it in the pre-push hook and, with `--strict`, in CI on every pull request.
* Merging is acceptance. A merged ADR changes only in its frontmatter, typos and links; changing the decision means a new ADR that supersedes it.

### Consequences

* Good, because every index line is generated, so the index cannot drift from the records.
* Good, because a location-bound rule sits in the code it governs, where every reader meets it.
* Good, because depth varies with the decision: a summary line, an ADR, and evidence only when there is some.
* Bad, because existing area docs must be migrated by hand, one area per PR, and until then the old and new systems coexist.
* Bad, because changing frontmatter adds a step: run `npm run docs:gen` and commit its output.
* Bad, because Claude Code reads `AGENTS.md` only when no `CLAUDE.md` or `CLAUDE.local.md` exists, so contributors keep personal instructions elsewhere.

## Pros and Cons of the Options

### Hand-written call-graph or layering docs

* Bad, because they are derivable from the code and drift from it.

### A fixed three-level depth

* Bad, because it forces padding onto small decisions.

### C4 or arc42

* Bad, because they are too heavy and rigid for a project this size.

### LLM-generated context files

* Bad, because they were measured to lower agent task success while raising cost (Gloaguen et al., "Evaluating AGENTS.md", 2026, https://arxiv.org/abs/2602.11988).

## More Information

Rejected details, from the design review:

* Directory categories: single-valued, and recategorizing renames files, which breaks links and anchors. Tags replace them.
* `scope` globs in frontmatter: mutable path data inside immutable records. Anchors carry location.
* A status enum, a frontmatter date, and people fields: merge is acceptance, the filename carries the date, and git carries authorship.
* A committed `CLAUDE.md` importing `AGENTS.md`: adds a vendor file and suppresses nested `AGENTS.md` files for Claude Code.

Sources: [MADR 4.0.0](https://adr.github.io/madr/),
[ARCHITECTURE.md](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html),
[How Claude remembers your project](https://code.claude.com/docs/en/memory),
[AGENTS.md](https://agents.md/).
