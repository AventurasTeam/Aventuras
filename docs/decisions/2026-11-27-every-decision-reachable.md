---
summary: 'Give every ADR a tag or an `ADR(slug)` anchor; an ADR with neither is reachable only by scanning General.'
tags: [documentation]
cross-cutting: false
---

# Warn about decisions that no tag or code anchor leads to

## Context and Problem Statement

`docs/README.md` groups decisions under their tags, and an untagged decision goes under "General", which has no description. Tags name concerns that cut across locations. A concern that maps to one directory gets an `ADR(slug)` anchor instead, so most decisions migrated from the area docs have no tag. Nothing checked that those decisions had an anchor, so one with neither could be found only by scanning General. How do we keep every decision reachable as the count grows?

## Considered Options

* Warn when an active, non-cross-cutting ADR has no tag and no anchor
* Make it an error
* Require every ADR to have a tag

## Decision Outcome

Chosen option: "Warn when an active, non-cross-cutting ADR has no tag and no anchor", because it points at the gap without blocking a push, and `--strict` makes CI enforce it.

* Only an anchor in a source file counts, not one in `docs/` or in a Markdown file. This check doesn't look at whether the anchor itself is valid. The anchor check reports invalid anchors.
* Cross-cutting ADRs are exempt because `AGENTS.md` already lists them.

### Consequences

* Good, because a decision that maps to one directory reaches readers through the code it governs, and nothing else needs maintaining.
* Good, because the check scans files the anchor check already reads.
* Bad, because a decision with no single code site needs a tag even when none fits well.

## Pros and Cons of the Options

### Make it an error

* Bad, because an ADR written before the code it governs would block a push.

### Require every ADR to have a tag

* Bad, because it forces a tag onto decisions that one directory already explains, and the tag vocabulary grows to cover them.

## More Information

Two notices cover growth. Neither fails the check, even under `--strict`.

* A tag that lists more than 20 decisions draws a notice to split it in `docs/decision-tags.yml`. General is exempt: untagged decisions are untagged on purpose, anchors reach them, and the warning above enforces that.
* An untagged deprecated ADR that no code anchors draws a notice to set `active: false`. The warning above does not apply to deprecated ADRs. Tagged ones are left out because they never rely on anchors.
