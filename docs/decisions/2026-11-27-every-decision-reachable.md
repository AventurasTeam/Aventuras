---
summary: 'Give every ADR a tag or an `ADR(slug)` anchor; an ADR with neither is reachable only by scanning General.'
tags: [documentation]
cross-cutting: false
---

# Warn about decisions that no tag or code anchor leads to

## Context and Problem Statement

`docs/README.md` groups decisions under their tags, and an untagged decision goes under "General", which has no description. Tags name concerns that cut across locations; a concern that maps to one directory is an `ADR(slug)` anchor instead, so decisions migrated from the area docs are mostly untagged. Nothing checked that such a decision has an anchor, so one with neither was findable only by scanning General. How do we keep every decision reachable as the count grows?

## Considered Options

* Warn when an active, non-cross-cutting ADR has no tag and no anchor
* Make it an error
* Require every ADR to have a tag

## Decision Outcome

Chosen option: "Warn when an active, non-cross-cutting ADR has no tag and no anchor", because it points at the gap without blocking a push, and `--strict` makes CI enforce it.

* An anchor counts only in a source file, not in `docs/` or a Markdown file, and the check ignores whether the anchor itself is valid; the anchor check reports those.
* Cross-cutting ADRs are exempt because `AGENTS.md` already lists them.

### Consequences

* Good, because a directory-shaped decision reaches a reader through the code it governs, and nothing else needs maintaining.
* Good, because the check scans files the anchor check already reads.
* Bad, because a decision with no single code site needs a tag even when none fits well.

## Pros and Cons of the Options

### Make it an error

* Bad, because an ADR written before the code it governs would block a push.

### Require every ADR to have a tag

* Bad, because it forces a tag onto decisions that one directory already explains, and the vocabulary grows to cover them.

## More Information

Two notices, which never fail even under `--strict`, cover growth:

* A tag that lists more than 20 decisions draws a notice to split it in `docs/decision-tags.yml`. General is exempt: untagged decisions are untagged on purpose, anchors reach them, and the warning above enforces that.
* An untagged deprecated ADR that no code anchors draws a notice to set `active: false`. Tagged ones are left out because they never rely on anchors, and the warning does not apply to deprecated ADRs.
