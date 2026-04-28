---
name: aventuras-drift-check
description: Lighter-touch periodic drift sweep of Aventuras docs — focused on the four deterministic classes (rename trail, pattern Used-by, followups in/out, boilerplate accretion). Smaller scope than aventuras-doc-audit; faster turnaround. INVOKE between design sessions or before milestones when you suspect accumulated drift but don't want a full audit.
---

# Doc drift check — Aventuras

A bi-weekly-cadence drift sweep, smaller than the full doc-audit. Catches the four deterministic drift classes that accumulate session-by-session — the stuff a per-session drift pass would prevent if every change went through one, but doesn't catch retroactive accretion.

The output is a structured report; the user triages from it. Read-only — no fixes applied.

<HARD-GATE>
Read-only audit. Do NOT modify any files in this run. The user reviews the report and applies fixes themselves (or in a follow-on session). The only writes permitted are the report itself in your response — and even that goes inline, not to a file unless the user explicitly asks.
</HARD-GATE>

## Position vs the other doc skills

Three layers of drift defense in this project, each with a different cadence + scope:

- **`aventuras-design` → Drift pass.** Per-session, runs against one diff just before the integration commit. Catches the four classes _at the moment they'd be introduced_. Subagent dispatched by the orchestrator inside a design session. ~30-60s per session.
- **`aventuras-drift-check` (this skill).** Periodic / on-demand, runs project-wide against the current state of `docs/`. Catches accumulated drift across many sessions — boilerplate that crept into a 4th doc, followup entries that silently outlived their canonical decision, pattern Used-by lists that fell behind. 5-10 minutes per run.
- **`aventuras-doc-audit`.** Full audit, 19 issue classes, 6 parallel subagents. Catches the judgment-shaped drift the lighter skills can't (cross-doc contradictions, schema-UI mismatch, README prose violations, scope leakage, heading-stability risks, etc.). Run when you suspect deeper rot, before milestones, or if drift-check surfaces ≥10 findings (signal that more is hiding).

If the per-session drift pass were 100% reliable, this skill would never find anything. In practice: design sessions sometimes skip the drift pass (the skill is opt-in, not auto-triggered for every doc edit), the boilerplate-detection check is heuristic enough to miss subtle duplications, and ad-hoc edits outside design sessions never get a drift pass at all. This skill is the catchnet for those.

## When to invoke

- **User says "check for drift"** or "drift sweep" or "between full audits."
- **Before a milestone** as a low-cost pre-flight.
- **After a stretch of design sessions** when the doc tree has had several integrations land.

If the user asks for a "doc audit" or "consistency check" without qualifying — they probably want the full `aventuras-doc-audit`. This skill's lighter scope is the difference; surface it and let them choose.

## Why discovery-first

Same reasoning as `aventuras-doc-audit`: the doc tree evolves (domains fan out into subdirs, patterns get added/retired, new conventions emerge). A skill that hardcodes paths goes stale the moment the tree shifts.

This skill **reads the project's structure rules each run** (from `docs/conventions.md`, `docs/README.md`) and **enumerates the actual file inventory** by globbing `docs/`. The four checks are derived from what's currently true.

## Checklist

Track as tasks; complete in order:

1. **Discovery.** Read `docs/conventions.md`, `docs/README.md`, glob `docs/**/*.md` and `docs/**/*.html`. Confirm the four conventions this skill checks against are still in use (per-screen `<screen>/<screen>.md` colocation, `principles.md` + `patterns/` split, `followups.md` ledger).
2. **Baseline lint.** Run `pnpm lint:docs` once. If it fails, surface mechanical errors first; user fixes those before the drift sweep continues.
3. **Dispatch 2 subagents in parallel.** Subagent A handles mechanical sweeps (renames + pattern Used-by). Subagent B handles prose-level checks (followups hygiene + boilerplate detection). See [Methodology](#methodology) for briefing details.
4. **Aggregate findings** by class. Within each class, sort by impact (highest first).
5. **Write report inline** in your response. Use the [Output format](#output-format).

If the report contains ≥10 findings, **end with an explicit recommendation to run the full `aventuras-doc-audit`** — that volume signals deeper consistency rot that the four mechanical checks aren't sized for.

## The four classes

Each class is the project-wide version of the same check `aventuras-design`'s drift pass runs per-session. The drift pass catches them at introduction; this skill catches accumulation.

### 1. Rename impact (project-wide)

Look for terminology / heading / schema-field names that have been **renamed in some places but not others**. The most common cause: a design session swept the canonical doc and 1-2 reference sites, but missed cross-doc citations or per-screen prose mentions.

How to find: scan recent commits' diffs for renames (`git log --oneline -20`, `git diff <commit>` for any commit touching headings or TS field names), then grep the rest of the repo for the **old** name. Any match is candidate drift.

What to flag:

- Anchor links `[label](./file.md#old-slug)` — but lint catches these, so by the time you're invoked these should be zero. If any exist, prioritize.
- Stale **labels** in cross-references where the URL now resolves (e.g., `[principles → X](.../patterns/...)` — the label says principles, the URL points at patterns). Lint doesn't catch this.
- Prose mentions of old field names / old terminology (`baseUnit` → `baseUnitName`, `app_settings.calendars` → `vault_calendars`).
- Schema-diagram comments out of sync with the decision section in the same file (silent internal drift).

### 2. Pattern Used-by lists out of date

For every pattern doc (`docs/ui/patterns/*.md` and any other `patterns/`-shape directory):

- Read its **Used by** list.
- Grep all per-screen docs for citations of that pattern (`patterns/<name>.md`).
- Any per-screen doc that cites the pattern but isn't in Used-by is a finding.
- Any Used-by entry that points at a per-screen doc which no longer cites the pattern is also a finding (less common, but possible if a surface dropped a pattern adoption).

This is a pure mechanical sweep; subagent A can do it faster than the orchestrator. The yield is high — Used-by lists drift fast because every new surface adoption requires updating two files.

### 3. Followups hygiene

For every entry in `docs/followups.md`:

- **Resolved-not-removed.** Search canonical docs for evidence the entry's deferral has landed. Heuristic: the entry's title keywords appear in `data-model.md` / `architecture.md` / per-screen docs as concrete decisions rather than open questions. Flag entries that look resolved.
- **Duplicate / leakage.** Two followup entries on overlapping topics; or a followup entry duplicating an open-question section in a per-screen doc; or a per-screen "open questions" section duplicating a followup. Flag the duplication.
- **Aged commentary.** Entries that read more like "noting this for posterity" than "parked decision needing future work." Followups are outstanding-only per the project rule; commentary that no longer represents a real deferral should be deleted.

For each finding, propose: **delete** (resolved), **consolidate** (merge two entries), or **collapse one into the other** (followup vs per-screen open-question).

Also check the inverse: any **canonical-doc TBD** that should be a followup. Search for `TBD`, `TODO`, "deferred", "pending design pass" in canonical docs. If found AND no corresponding followup entry exists, flag.

### 4. Boilerplate accretion (per-screen prose duplication)

The hardest check, and the highest-yield one. Find prose that lives in 2+ per-screen docs near-verbatim, that should live in `principles.md` or `patterns/` and be cited from each.

Heuristics:

- **2+ matching sentences across surfaces** = candidate.
- **4+ matching sentences** = strong signal.
- **Exact phrase match on cross-cutting concepts** ("save session lifecycle", "search bar scope", "import counterparts", "always-visible-but-muted") — find the canonical pattern doc; flag every per-screen doc that restates instead of cites.

For each finding:

- Name the canonical home (which existing pattern / principle should hold the prose).
- List the per-screen docs that restate it.
- Mark intentional vs accidental: a brief restatement framing context (one sentence) is fine; a full re-narration of the contract is drift.

This check often surfaces the most findings on a long-running tree. Don't be alarmed by counts; consolidation is usually mechanical once flagged.

## Methodology

Dispatch two parallel subagents (use `Agent` tool with `subagent_type=general-purpose`):

### Subagent A — Mechanical sweeps (rename + pattern Used-by)

Brief:

```
You are auditing project docs for two specific drift classes:

1. Rename impact (project-wide). Use git log --oneline -20 to surface recent
   commits that renamed headings or schema-field names. For each rename, grep
   the rest of `docs/` for the OLD name. Report:
     - Stale label drift (cross-refs whose label says X but URL points elsewhere).
     - Prose mentions of old terminology.
     - Schema-diagram comments out of sync with decision sections in the same file.

2. Pattern Used-by lists out of date. For each pattern doc in
   docs/ui/patterns/*.md (and any other patterns/-shape directory):
     - Read its "Used by" list (or equivalent — discover the convention from
       the file itself).
     - Grep all per-screen docs for citations of that pattern.
     - Report mismatches in either direction.

Output a structured list of findings, one per drift instance:
  - file:line citing the old name (or the missing Used-by entry)
  - what should be there instead
  - confidence (high/medium/low based on whether you verified or inferred)

Do NOT modify any files. Read-only.
```

### Subagent B — Prose checks (followups hygiene + boilerplate)

Brief:

```
You are auditing project docs for two prose-level drift classes:

1. Followups hygiene. Read docs/followups.md end-to-end. For each entry:
   - Search canonical docs (data-model.md, architecture.md, per-screen
     docs/ui/screens/*.md, calendar-systems/spec.md if present) for evidence
     the deferral has landed.
   - Flag resolved-not-removed entries with citation evidence.
   - Flag duplicates between followups entries OR between a followup and a
     per-screen "open questions" section.
   - Flag aged commentary that no longer represents a real deferral.

   Also check the inverse: search canonical docs for "TBD", "TODO",
   "deferred", "pending design pass". For any match, check if a followup
   entry covers it. If not, flag.

2. Boilerplate accretion. Find prose duplicated across 2+ per-screen docs
   that should be cited from a single canonical pattern/principle:
   - Heuristic: 2+ matching sentences = candidate; 4+ = strong signal.
   - Look for exact phrase matches on cross-cutting concepts (save session,
     search bar scope, import counterparts, icon-actions visibility, etc.).
   - For each, name which existing pattern/principle is the canonical home
     and list the per-screen docs that restate.

Output a structured list of findings. Mark intentional context-setting
restatements (one sentence in a per-screen doc) as no-drift; flag full
re-narrations as drift.

Do NOT modify any files. Read-only.
```

Both subagents return structured findings. Orchestrator aggregates, deduplicates if any overlap, and writes the report.

## Output format

A single Markdown report **inline in your response**:

```
# Drift check report — <date>

## Summary

- Discovery: <N> docs found, <M> wireframes, conventions in use: <list>.
- Baseline lint: pass / fail.
- Findings count per class:
    - Rename impact: <N>
    - Pattern Used-by: <N>
    - Followups hygiene: <N>
    - Boilerplate accretion: <N>
- Recommendation: triage inline OR escalate to full doc-audit (if total ≥10).

## Findings

### Rename impact

For each finding:
- **Location**: file:line
- **Old name → new name**: e.g., `app_settings.calendars` → `vault_calendars`
- **Where canonical decision landed**: file#anchor
- **Suggested fix**: 1 sentence
- **Confidence**: high/medium/low

### Pattern Used-by

For each finding:
- **Pattern**: docs/ui/patterns/<name>.md
- **Direction**: "<surface> cites pattern but Used-by missing it" OR "Used-by lists <surface> but surface no longer cites"
- **Suggested fix**: add/remove the Used-by entry
- **Confidence**: high (mechanical)

### Followups hygiene

For each finding:
- **Entry**: followups.md → <heading>
- **Issue**: resolved-not-removed / duplicate / aged-commentary / canonical-TBD-needs-followup
- **Evidence**: short quote or citation showing the issue
- **Suggested resolution**: delete / consolidate with X / move to followups
- **Confidence**: high/medium/low

### Boilerplate accretion

For each finding:
- **Topic**: e.g., "save-session lifecycle"
- **Canonical home**: principles.md#<anchor> or patterns/<name>.md
- **Per-screen docs restating**: list of file:line ranges
- **Suggested resolution**: collapse each restating doc to a one-line cite + screen-specific deviations only
- **Confidence**: high/medium/low

## Recommendation

If total findings ≥10: "Recommend running aventuras-doc-audit — drift volume suggests deeper rot the four mechanical classes don't cover."

Otherwise: "Triage inline. Most fixes are mechanical (drift-pass-shape work)."
```

## Out of scope

- **The 15 issue classes the full audit covers** beyond these four. If discovery surfaces obvious instances of (e.g.) cross-doc contradictions, README prose violations, schema-UI drift, scope leakage, heading-stability risks — note them in passing under "Other observations" but don't audit deeply. Recommend the full audit instead.
- **File modification.** Read-only.
- **Code-vs-doc drift.** This skill stays within `docs/` like the full audit does.
- **Lint mechanics.** `pnpm lint:docs` runs as the baseline; your job is the four semantic classes lint can't do.
- **Asking the user clarifying questions.** Surface ambiguities as findings.

## Constraints

- **Be specific.** "Some boilerplate exists" is not actionable; "save-session lifecycle restated near-verbatim in plot.md:248-253, story-settings.md:511-517, app-settings.md:395-400" is.
- **Be conservative on confidence.** "Inferred" vs "verified" matters — the user explicitly distinguishes them.
- **Stay in scope.** If you find a contradiction class issue, note it briefly and recommend the full audit rather than expanding this skill's checks. Mission creep dilutes the lighter-touch shape that makes this skill useful.
- **Discovery-first, every run.** Never trust a baked-in file list — the doc tree fans out; the skill rides on the project's own structure rules at runtime.
