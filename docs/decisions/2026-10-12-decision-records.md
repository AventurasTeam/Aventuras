---
summary: "Record the intent code can't express as an ADR when it spans more than one site or won't fit in a short comment."
tags: [documentation]
cross-cutting: true
---

# Record decisions as ADRs with a generated index, not hand-written area docs

## Context and Problem Statement

`docs/` restated what the code says, drifted from it, and grew without structure. Agents read it, trusted it, and acted on stale content or spent time and context working out what was true. How do we keep the reasoning that does not fit in a comment without keeping a second, drifting copy of the code, and without an index that grows with every choice anyone makes?

## Considered Options

* ADRs with a generated index, code anchors and a validating script
* Hand-written area docs, kept as they were
* Hand-written call-graph or layering docs
* A fixed three-level depth per decision (ruling, spec, research)
* C4 or arc42
* LLM-generated context files

## Decision Outcome

Chosen option: "ADRs with a generated index, code anchors and a validating script", because it keeps only intent (conventions, conditional rules, intentional gaps and their reasons) and lets tooling check everything that can be checked.

* Where a choice is recorded depends on how far its reason reaches and how costly it would be to rediscover or to undo by mistake, not on how much work went into it:
  1. The reason fits in a short comment at one site: a code comment, not an ADR.
  2. The reason spans files, won't fit in a short comment, or guards a choice a reader would plausibly undo, and it stays within one area: an untagged ADR. `scope` names the directories it governs; an `ADR(slug)` comment marks a single site.
  3. It constrains work across areas: a tagged ADR, listed in `docs/README.md`.
  4. Every change must follow it: `cross-cutting: true`, which also copies it into `AGENTS.md`.
* A refinement of a recorded decision amends that ADR; it does not get one of its own.
* Each decision is one MADR-style file, `docs/decisions/YYYY-MM-DD-slug.md`. The slug is its ID. The frontmatter holds a one-line `summary`, `tags` from `docs/decision-tags.yml`, `scope`, `cross-cutting`, `active` and `superseded-by`. State comes from those last two, and there is no status field.
* `docs/README.md` lists tagged decisions only, so it grows with the decisions that span areas. The code leads to the rest:
  * `scope` lists repository-relative directories, not globs. For each, `npm run docs:gen` writes a generated block of those ADRs' summaries into `<dir>/AGENTS.md`. Claude Code loads it when its Read tool opens a file at or below the directory; other agents read nested `AGENTS.md` files by their own rules. Text outside the block is hand-written and kept; a file that holds nothing else is deleted once no ADR scopes it.
  * An `ADR(slug)` comment ties a decision to the code it governs. Anchors to a superseded, retired or missing ADR fail the check. Only anchors in source files count, not ones in `docs/` or in Markdown.
  * An active ADR with no tag, no scope and no anchor draws a warning, which `--strict` turns into a CI failure. Cross-cutting ADRs are exempt, because `AGENTS.md` lists them.
* `docs/README.md`, the cross-cutting block in `AGENTS.md` and the scoped blocks are generated from frontmatter by `npm run docs:gen` and never edited by hand.
* Raw material goes in `docs/evidence/`, as a file or a folder, and an ADR must link it or a folder above it. Coverage goes by link, not by name; name evidence for its topic, since a successor ADR links the same material.
* `docs/ARCHITECTURE.md` is the one human-owned map: areas, boundaries and invariants, revisited a few times a year.
* `AGENTS.md` is the only agent instruction file. Nothing vendor-specific is committed.
* `scripts/docs-check.ts` validates all of it in the pre-push hook and, with `--strict`, in CI on every pull request.
* Merging is acceptance. After merge, the summary is the ruling and never changes, and the slug never disappears: retire an ADR with `active: false` instead. The rest of the record, frontmatter and body, may be refined while the summary still holds. When it no longer does, write a new ADR that supersedes it. The check compares summaries with the merge-base of `origin/master`.

### Consequences

* Good, because every index line is generated, so the index cannot drift from the records.
* Good, because a rule about specific code reaches every reader of that code, through its directory's `AGENTS.md` or a comment at the site.
* Good, because depth varies with the decision: a comment, a summary line, an ADR, and evidence only when there is some.
* Good, because refining a decision edits its record instead of adding one, so the count tracks decisions, not edits.
* Bad, because existing area docs must be migrated by hand, one area per PR, and until then the old and new systems coexist.
* Bad, because changing frontmatter adds a step: run `npm run docs:gen` and commit its output.
* Bad, because a typo in a merged summary stays, or takes a superseding ADR to fix.
* Bad, because a body may drift from its frozen summary; review catches that, as it catches code that drifts from its ADR.
* Bad, because a decision with no single code site and no directory needs a tag even when none fits well.
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

* Directory categories: a decision can sit in only one, and moving it to another renames the file, which breaks links and anchors. Tags replace them.
* `scope` globs: patterns hide which paths they match, and a glob that matches nothing fails silently. `scope` takes directories instead, and the check fails when one no longer exists, so a rename cannot leave it stale.
* A status enum, a frontmatter date, and people fields: merge is acceptance, the filename carries the date, and git carries authorship.
* A committed `CLAUDE.md` importing `AGENTS.md`: adds a vendor file and suppresses nested `AGENTS.md` files for Claude Code.
* Path-scoped `.claude/rules/` for directory rules: a vendor file, read by one agent only.
* A separate notes type for local knowledge: an untagged ADR with `scope` or an anchor covers it, with the same checks.
* Listing untagged ADRs under a General heading: the index then grows with every local choice, and readers scan it for decisions the code already leads to.
* Immutable records after merge: every refinement becomes a new ADR, and the count climbs with edits rather than decisions. Freezing all frontmatter instead would block `superseded-by`, `active` and retagging; freezing the "Chosen option" line as well duplicates the summary.
* An error, rather than a warning, for an ADR nothing leads to: an ADR written before the code it governs would block a push.
* A required tag on every ADR: it forces a tag onto decisions that one directory already explains, and the vocabulary grows to cover them.

Two notices cover growth. Neither fails the check, even under `--strict`.

* A tag that lists more than 20 decisions draws a notice to split it in `docs/decision-tags.yml`.
* An untagged, unscoped deprecated ADR that no code anchors draws a notice to set `active: false`.

Nested `AGENTS.md` loading was tested with Claude Code 2.1.332: with `src/lib/services/ai/AGENTS.md` and `src/lib/services/ai/image/AGENTS.md` in place, reading a file in `src/lib/services/ai/image/providers/` loaded both. Every `AGENTS.md` between the working directory and the file is read, so a `scope` covers its whole subtree.

Sources: [MADR 4.0.0](https://adr.github.io/madr/), [ARCHITECTURE.md](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html), [How Claude remembers your project](https://code.claude.com/docs/en/memory), [AGENTS.md](https://agents.md/).
