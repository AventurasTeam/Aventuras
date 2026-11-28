---
# Copy this file to docs/decisions/YYYY-MM-DD-slug.md, or into any subdirectory of it.
# The date is when the decision was made. The slug is the ADR's ID: lowercase kebab-case, unique
# across docs/decisions/, and never changed after merge.
#
# Write an ADR for intent the code can't express when it spans more than one site or won't fit in
# a short comment; a reason that fits in a short comment at one site stays a comment. A refinement
# amends the ADR it refines.
#
# Required. The ruling in one or two imperative sentences, readable without opening the file.
# Aim for under 118 characters, one line; over 236 draws a notice, and 512 is the limit. It
# becomes this ADR's line in docs/README.md and scoped AGENTS.md files. After merge it never
# changes: to change the ruling, supersede this ADR.
summary: '{Do X; Y would break Z.}'
# Optional, default []. Concerns that cut across areas, from docs/decision-tags.yml. Only tagged
# ADRs are listed in docs/README.md. An untagged ADR is local and needs a scope or an ADR(slug)
# anchor, or nothing leads to it.
tags: []
# Optional, default []. Repository-relative directories this governs, not globs. docs:gen writes
# the summary into each one's AGENTS.md, which Claude Code loads when it reads a file at or
# below that directory.
scope: []
# Optional, default false. true copies the summary into AGENTS.md, which every agent loads.
# Only for rules every change must follow; the block has a line budget.
cross-cutting: false
# Optional. The slug of the ADR that replaces this one.
# superseded-by: other-slug
# Optional. Defaults to true without superseded-by and false with it.
#   true,  no superseded-by: active
#   true,  superseded-by:    deprecated; existing code may keep it, new code follows the successor
#   false, superseded-by:    superseded; delisted, and anchors to it fail
#   false, no superseded-by: retired; delisted, and anchors to it fail
# active: true
---

# {Short title of the problem and solution}

## Context and Problem Statement

{Two or three sentences, or a question.}

## Considered Options

* {Option 1}
* {Option 2}

## Decision Outcome

Chosen option: "{Option 1}", because {justification}.

### Consequences

* Good, because {positive consequence}
* Bad, because {negative consequence or accepted downside}

<!-- Optional:

## Pros and Cons of the Options

### {Option 1}

* Good, because {argument}
* Bad, because {argument}

-->

## More Information

{Optional. Exceptions, links to evidence in docs/evidence/, related ADRs.}
