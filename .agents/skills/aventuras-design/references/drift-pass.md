# Drift pass

Part of aventuras-design: the procedure for its checklist step 13. Read it when canonical-doc edits are staged and before the commit fires.

After canonical-doc edits are staged but before the commit fires, dispatch a **fresh subagent** to check the staged diff against the integration plan. Session context biases toward "I thought really hard, this is right" — the audit-fix work that prompted this stage found exactly the kind of drift the original session writers didn't see. Fresh eyes with deterministic checks catch the common cases.

### Why a subagent

- **No session bias.** The orchestrator's context includes hours of "this is the right design" — that lens makes drift invisible. A subagent sees only the diff + the plan + the rules to check against.
- **Forced explicitness.** Briefing the subagent forces the orchestrator to articulate exactly what was supposed to happen.
- **Fresh prompt budget.** The orchestrator has consumed context discussing the design; the subagent gets a clean window for focused checks.

### Subagent invocation

Use the `general-purpose` subagent type (no specialized agent needed). Brief it with:

- The staged diff: `git diff --staged` (or work-tree diff if not yet staged).
- The integration plan from this design session (verbatim — names files / sections / followups it intended to touch).
- The four drift checks below, each with a "report drift if X" rule.

Tell it explicitly: **"Report drift findings only. Do not re-evaluate the design itself. Do not propose alternative approaches. The design is locked; you're checking that what got written matches what was planned + standing project rules."**

### The four checks

1. **Rename impact.** If the diff renames any heading (`## X` → `## Y`) or schema field name (TS comment, ER diagram, prose mention), grep the rest of the repo for inbound refs to the old name. Report any inbound ref the diff didn't sweep. Special attention to:
   - Anchor links `[label](./file.md#old-slug)` — lint catches the broken anchor but not stale labels.
   - Prose mentions of the old name in per-screen docs.
   - Cross-doc references in `principles.md` / `patterns/*.md`.

2. **Pattern adoption.** If the diff adds a citation like `[xxx pattern](../../patterns/<pattern>.md)` from a per-screen doc that wasn't already in that pattern's `Used by` list, report. The pattern doc's Used-by list is the canonical surface→pattern map; a new adoption that doesn't update it leaves the pattern stale.

3. **Followups in / out.** Two questions:
   - **Resolved any parked decision?** Grep `followups.md` for keywords matching changed canonical content (field names, feature names from the integration plan). If a followup entry references something the diff just resolved, report — entry should be removed.
   - **Deferred anything new?** If the diff prose contains "deferred", "TBD", "pending design pass", or similar, AND the diff doesn't add a `followups.md` entry covering it, report — the deferral should be parked.

4. **Boilerplate detection.** If the diff writes prose into a per-screen doc that closely matches prose already in another per-screen doc, report. Heuristic: 2+ matching sentences = candidate; 4+ = strong signal. Cross-cutting prose belongs in `principles.md` or `patterns/`, not duplicated. (Soft check — orchestrator weighs surface-specific deviations against generic boilerplate.)

### Output shape

Subagent returns structured findings, one per check:

```
### Rename impact
[no drift] OR [drift: <file>:<line> still references old name `X`; planned rename to `Y` in <other file>]

### Pattern adoption
[no drift] OR [drift: <surface doc> cites <pattern>, but <pattern>.md → Used by doesn't list <surface>]

### Followups in/out
[no drift] OR [drift: <followup entry name> appears resolved by this integration but the followup wasn't removed]
[no drift] OR [drift: integration prose defers <topic> but no followup entry was added]

### Boilerplate detection
[no drift] OR [drift: <surface A>:<lines> and <surface B>:<lines> contain near-identical prose about <topic>; consider promoting]
```

### What the orchestrator does with findings

- **No drift across all four checks** → proceed to commit. Drift pass took 30-60s; cost is acceptable as standing tax.
- **Drift found, mechanical fixes only** (rename ref to update, Used-by entry to add, followup to remove/add) → apply inline, re-stage, commit.
- **Drift found, judgment call needed** (boilerplate detection often surfaces things that are intentionally local) → surface to user with the subagent's evidence; user decides whether to fix or note as intentional.
- **Findings extensive** (~5+ non-trivial) → don't auto-fix. Surface the full list to the user; redesign-or-revise might be warranted.

The subagent never commits. Only the orchestrator commits, after fixes are applied.
