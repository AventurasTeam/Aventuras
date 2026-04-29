---
name: aventuras-doc-audit
description: Read-only audit of Aventuras docs + wireframes for contradictions, drift, staleness, duplication, and other consistency rot. Discovery-first (reads the project's own structure rules each run, so it adapts as the doc tree fans out). Produces a structured report; the user triages and fixes. INVOKE when the user asks for a doc review / consistency check / drift sweep — NOT autonomously after each doc edit.
---

# Doc + wireframe audit — Aventuras

Audit project documentation and wireframes for drift, contradictions, staleness, and duplication. The output is a structured report; the user triages from it. The skill encodes the audit framework; the project's own structure rules (read at runtime) supply the conventions to measure against.

<HARD-GATE>
Read-only audit. Do NOT modify any files in this run. The user reviews the report and applies fixes themselves (or in a follow-on session). The only writes permitted are the report itself in your response — and even that goes inline, not to a file unless the user explicitly asks.
</HARD-GATE>

## Why discovery-first

The Aventuras doc tree evolves: domains start as single files (`docs/architecture.md`), fan out into subdirs with their own `README.md` index when they grow (precedent: `docs/calendar-systems/`). New patterns get added; old ones retire; principles content migrates between `principles.md` and `patterns/`. A skill that hardcodes paths breaks the moment that happens.

This skill **reads the project's structure rules each run** (from `docs/conventions.md`, `docs/README.md`, `.claude/rules/docs.md`, and `CLAUDE.md`) and **enumerates the actual file inventory** by globbing `docs/`. The audit's checks are derived from what's currently true, not from a snapshot baked into the skill. As a side effect, the skill self-audits: if files exist that aren't in the README index (or vice versa), that's itself a finding.

## Checklist

Track as tasks; complete in order:

1. **Discovery.** Read structure rules + enumerate inventory + detect conventions in use. Build the audit plan from what's found.
2. **Baseline lint.** Run `pnpm lint:docs` once. If it fails, surface that first — mechanical errors should be fixed before the semantic audit. (User decides whether to proceed; you do not fix.)
3. **Audit dispatch.** Slice the work into parallel subagents where genuinely independent. Brief each subagent with its files + relevant issue classes + output shape.
4. **Aggregate findings.** Collect subagent results; deduplicate; sort by impact within class.
5. **Self-audit pass.** Check for drift in the skill's own assumptions vs the current doc tree (see [Self-audit](#self-audit) below).
6. **Write report.** Single Markdown report inline in your response (do NOT write to a file unless explicitly asked). Use the [Output format](#output-format).

## Discovery phase

Run these reads in parallel at the start of every audit:

- `docs/conventions.md` — source of truth for "where files live", "naming conventions", "principles-vs-patterns split", "README-as-index", "Followups vs parked" placement rule, "wireframe authoring", tooling, common pitfalls.
- `docs/README.md` — authoritative index of what files should exist (cross-check against your glob inventory).
- `.claude/rules/docs.md` — operational reminders for AI-assisted edits (anchor discipline, heading stability, bracketed inline text, followups hygiene, lint tooling).
- `CLAUDE.md` — repo root project context (domain, repo layout, workflow rules).
- `git log --oneline -15` — recent activity (ground for "what changed lately" findings).

Then enumerate the actual inventory:

- Glob `docs/**/*.md` — every Markdown doc.
- Glob `docs/**/*.html` — every wireframe.
- Glob `docs/**/README.md` — every index file (these are subdir-as-domain markers).

Cross-check the README's index against the glob inventory. **Any file that exists but isn't indexed, or any indexed file that doesn't exist, is itself a finding** (stale index / orphaned file).

Detect conventions in use:

- Per-screen `<screen>/<screen>.md` + `<screen>.html` colocation? — drives the wireframe-vs-doc drift check.
- `docs/followups.md` exists? — drives the followup hygiene check.
- `docs/explorations/` exists? — drives the decision provenance check.
- `docs/ui/principles.md` + `docs/ui/patterns/` split? — drives the principles-vs-patterns mis-classification check.
- Any other patterns visible in the tree? — flag in the report as conventions worth codifying if they're undocumented.

## Issue classes

Categorize findings into these classes. Don't limit yourself; flag anything else that'll cause future thrash in an "Other" bucket. **Conditional classes fire only if the corresponding convention is in use** (per discovery).

1. **Contradictions.** Same topic spec'd two different ways across docs (principles says X, per-screen says Y).
2. **Wireframe vs doc drift.** _(Conditional: per-screen `.md` + `.html` colocation in use.)_ The `.md` spec disagrees with the colocated `.html`. Compare chrome elements (top-bar shape, icons, popovers, breadcrumbs), row indicators (left-edge stripes, background tints, status pills, lead badges), modal markup vs spec'd shape, demonstrated states.
3. **Stale information.** References to renamed features / removed sections / retired patterns. Anchors that resolve mechanically but whose destination has shifted such that the citing context is no longer accurate. Old terminology replaced without all uses updated.
4. **Duplicate information ripe for consolidation.** Same prose reused near-verbatim across multiple docs that should live in one canonical place (`principles.md` for cross-cutting philosophy, `patterns/` for component specs) and be cross-referenced. Heuristic from `docs/conventions.md → Cross-cutting vs single-surface`: "single-surface stays in per-screen doc; 2+ surfaces means promote to principles or patterns."
5. **Cross-reference asymmetry.** A links to B for context X, but B doesn't actually cover X (or covers something subtly different). A says "see B for X" but X is in C.
6. **Followup hygiene.** _(Conditional: `followups.md` exists.)_ Items silently resolved by integration but not removed; items contradicted by later canonical decisions; duplicate / near-duplicate entries; items aged into "this is now decided, just delete me."
7. **Schema vs UI drift.** `data-model.md` (or `data-model/*` if fanned out) defines a shape; UI docs render or operate on it. Flag where the UI's mental model disagrees with the schema (field name, cardinality, nullability, type assumption).
8. **Architecture vs UI drift.** `architecture.md` (or `architecture/*` if fanned out) defines pipeline / orchestration / state contracts; UI docs cite or assume them. Flag UI assumptions that contradict the architectural contract (sync vs async gates, store ownership, transaction boundaries, abort semantics).
9. **Principles vs patterns mis-classification.** _(Conditional: `principles.md` + `patterns/` split in use.)_ Content in `principles.md` that's actually component-spec (belongs in `patterns/`), or vice versa. Heuristic: "conceptual / philosophy → principles; component spec → patterns."
10. **README-as-index violations.** Any `README.md` carrying substantive prose. Per the structure rule, READMEs are navigation only — keeps them refactorable without breaking inbound anchor links.
11. **Naming convention violations.** Non-kebab-case filenames; wireframe basename not matching doc basename; prefixed filenames (e.g., `ui-reader-composer.md` instead of `reader-composer.md`); file in the wrong directory per the topic-fan-out rule.
12. **Heading instability risk.** Sections with many inbound anchor references whose heading text reads provisional ("design rule — essentials vs discretionary" — survived being renamed once, but watch for similar). Drift-prone, not necessarily broken now.
13. **Bracketed inline text without backticks.** Prose containing `[A|B]` or `[Classification ‖ Translation]` etc. — remark parses these as reference-style links. Should be wrapped in backticks. Lint catches the obvious cases; you catch the subtle ones (e.g., text in code blocks accidentally outside backticks).
14. **Inconsistent terminology.** Same concept named differently across docs (e.g., "in-scene" vs "scene-present" vs "currently-in-scene"). List variants; propose a canonical name; do NOT change.
15. **Hand-waved decisions.** `TBD`, `TODO`, "to be decided", vague "we should consider" in canonical docs. Should either land in `followups.md` or be resolved. Exploration docs are exempt — they're history.
16. **Implicit assumptions presented as conclusions.** Assertive prose ("the X is Y") that's actually inferred / unverified. The user's collaboration style explicitly wants assumed-vs-verified distinguished. Flag canonical assertions that read load-bearing but lack grounding.
17. **State coverage gaps in wireframes.** _(Conditional: wireframes in use.)_ Wireframes should demonstrate key states (empty, loading, error, dirty, in-flight, conditional render variants). Missing important states is a gap, especially on screens with several behavioral modes.
18. **Decision provenance gaps.** _(Conditional: `explorations/` exists.)_ A decision appears in an exploration doc but never landed in the canonical doc its "Integration plan" promised. Exploration was supposed to apply and didn't, or applied partially.
19. **Tooling-rule violations not caught by lint.** Duplicate substantive content under READMEs that lint doesn't flag; anchor slugs that resolve to a different heading because of accidental near-duplicate slugs; etc. (`pnpm lint:docs` is the baseline; everything beyond is your job.)

## Methodology

The audit is broad enough that **parallel subagents speed it up significantly**. Use the Agent tool with `subagent_type=general-purpose` (or `subagent_type=Explore` for pure read-only reconnaissance) and dispatch in parallel where slices are genuinely independent.

Suggested slicing — adapt based on what discovery surfaces:

- **Subagent A — Cross-cutting rules vs per-screen contradictions.** Read every cross-cutting doc (`docs/ui/principles.md` if present, every `docs/ui/patterns/*.md`). For each rule, scan every per-screen doc (`docs/ui/screens/<screen>/<screen>.md` + nested sub-screens) for places that effectively countermand it.
- **Subagent B — Wireframe vs doc drift.** _(Skip if no wireframes.)_ For each per-screen directory, diff the `.md` spec against the colocated `.html`. Compare chrome / row indicators / modals / state coverage. The most common drift class — landed integrations sometimes update one and not the other.
- **Subagent C — Patterns coverage + duplication.** Read every cross-cutting pattern doc. For each, find prose in per-screen docs that duplicates the pattern (should be cross-referenced) and content in principles that's actually pattern-shaped (or vice versa).
- **Subagent D — Followups hygiene.** _(Skip if neither ledger exists.)_ Read both `docs/followups.md` (active items) and `docs/parked.md` (post-v1 confirmed + parked-until-signal). For each entry in either file, search canonical docs for evidence of resolution. Flag silently-resolved, contradicted, duplicated, or aged entries. Also flag entries whose placement (active vs parked) looks wrong relative to the placement rule in `conventions.md → Followups vs parked`.
- **Subagent E — Domain cross-refs.** Read top-level domain docs (`architecture.md`, `data-model.md`, `calendar-systems/spec.md`, or whatever the discovery turned up). For each schema field or pipeline contract, find UI docs operating against it; flag drift.
- **Subagent F — Anchor + structural integrity.** Walk every cross-reference in every doc. Verify destination section content matches the citing context semantically (not just that the anchor resolves). Walk file naming + structure rules and flag violations.

When dispatching, brief each subagent with: (a) the working directory, (b) which files it owns, (c) the issue classes most relevant to its slice, (d) the output shape (return a structured list of findings, not narrative). Subagents must NOT modify anything.

If you don't dispatch — fine, do it sequentially. But a single agent reading 40+ files sequentially is much slower than 5–6 specialized agents in parallel. The user's collaboration style favors parallelism; default to it.

## Self-audit

Before writing the report, do a quick pass on the skill's own assumptions vs reality:

- **Index completeness.** Did glob find files not referenced from `docs/README.md`? → finding.
- **Index correctness.** Does `docs/README.md` cite files that don't exist? → finding.
- **Convention coverage.** Did you observe a pattern in use that's not codified in `docs/conventions.md` or `.claude/rules/docs.md`? → meta-finding (worth surfacing as a structure-rule update suggestion).
- **Skill assumption coverage.** If you found a domain or convention this skill's checklist doesn't address, note it — the skill itself drifts when the project does, and the user maintains it.

These self-audit findings go into the report under their own section so the user can patch the skill as part of triage.

## Output format

A single Markdown report **inline in your response**. Structure:

```
# Doc + wireframe audit report — <date>

## Summary

- Discovery: <N> docs found, <M> wireframes, <conventions detected>.
- Baseline lint: pass / fail (<details if fail>).
- Findings count per class (e.g., 3 contradictions, 8 drift, 4 stale, 5 duplication, 2 followup hygiene, …).
- Top 5 highest-priority issues with one-line each.

## Findings

For each finding:

### [class] Brief title
- **Location(s)**: file:line (or file#anchor) for each affected spot
- **What's wrong**: 1–3 sentence description
- **Evidence**: short quotes or structural pointers showing the issue
- **Suggested resolution**: 1–2 sentences (don't apply — propose)
- **Confidence**: high / medium / low — based on whether you verified or inferred

Group by class. Within a class, sort by impact (highest first).

## Cross-cutting observations

Patterns that recur — e.g., "icon-actions pattern is duplicated in prose across 4 per-screen docs; ripe for consolidation." These suggest systemic improvements rather than per-instance fixes.

## Self-audit findings

Drift between this skill's checklist and the current doc tree (per [Self-audit](#self-audit)). Useful for the user to maintain the skill itself.

## What looks healthy

Brief positive section: surfaces or rules where consistency holds. Useful baseline so the user sees the audit isn't only-negatives.
```

## Out of scope

- **Subjective improvements** unrelated to drift / contradiction / staleness / consolidation. "This section reads dry" is out; "this section contradicts X" is in.
- **File modification.** Read-only.
- **Code-vs-doc drift.** Don't audit `app/`, `electron/`, `lib/`, etc. Code-vs-doc is its own audit; this one is doc internal consistency.
- **Exploration docs as canonical.** `docs/explorations/*.md` are by-design historical; them being stale relative to canonical is expected. EXCEPT: flag any case where an exploration's "Integration plan" was supposed to apply to canonical and didn't (provenance gap).
- **Lint mechanics.** `pnpm lint:docs` enforces anchor resolution + duplicate headings + bracketed-link parsing. Run it once at start to confirm a clean baseline; your job is the semantic / structural audit lint can't do.
- **Asking the user clarifying questions before starting.** The audit scope is what's in this skill; act on it. Surface ambiguities you encounter as findings, not as questions.

## Constraints

- **Be specific.** "Inconsistency in chrome" is not actionable; "principles.md:94 says X, world.md:34 ASCII shows Y" is.
- **Be conservative on confidence.** If inferring rather than verifying, say so. Distinguish "I read both files and they contradict" from "this looks like it might contradict — worth checking."
- **Don't compress under length pressure.** The user explicitly wants thoroughness; better a long structured report than a short impressionistic one.
- **Be readable.** A long report still reads cleanly with consistent structure across findings.
- **Discovery-first, every run.** Never trust a baked-in file list — the doc tree fans out; the skill rides on the project's own structure rules at runtime.
