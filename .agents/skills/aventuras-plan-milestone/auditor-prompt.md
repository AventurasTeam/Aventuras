# Auditor Dispatch Template

Use this template when dispatching an auditor (SKILL.md → Stages 6 and 8). The role (how to try to break a claim, what a finding holds) is the `aventuras-milestone-auditor` agent's definition, `.claude/agents/aventuras-milestone-auditor.md` (Opus, effort `xhigh`); this template is the per-angle part.

```
Dispatch the aventuras-milestone-auditor agent with:
  description: "Audit M<N>: [angle]"
  prompt: |
    Milestone doc: [absolute path]
    Slices: [absolute path of slices.md for Stage 6; the slice doc paths for Stage 8]
    Angle: [the angle's text, verbatim]
    Also read: [what the angle names]
    Write to: [absolute path in the working directory: audit-<angle>.md, or final-<angle>-<n>.md for Stage 8]
    Repository: [absolute path], at [HEAD_SHA]
```

## Contract audit angles (Stage 6)

**code.** For every contract, pinned shape and seam in the milestone doc and slice entries, find the shipped code it extends and check that it can do what's claimed: its signatures, what the runtime accepts and rejects, and what happens on each path, including paths the doc doesn't mention. Walk one concrete case through each contract, then through whatever later reads or reverses what it wrote. Also read: the code and the canon the contracts cite. Not the research digests.

**seams.** Find every type, interface and behavior crossing two or more slices, and check that each is pinned in Slice contracts or explicitly sequenced. Check the dependency graph: every dependency has an edge, there are no cycles, and gates land before gated work in every ordering. Find slices the graph runs at once that change the same code, schema or migrations, and check that a contract covers it. Check that the roadmap's cross-cutting tables naming this milestone are reflected. Also read: the roadmap entry and its cross-cutting tables, and the code the slices share. Not the research digests.

**coverage.** For every capability canon assigns to this milestone, and every must-land promise, find the slice it lands in. Flag what isn't slotted, is slotted ambiguously, or is slotted twice. Check that the Definition of done is reachable from the slices as written. Flag size only for a slice above about 20 plan tasks. Also read: the canon the milestone touches, and `research-promises.md`.

## Final audit angles (Stage 8)

**slice-docs.** For each slice doc named, check that:

- every acceptance criterion can be checked without asking the author, through a named command, an observable behavior or a specific test file;
- Required reading covers the canon the executing dev needs (remark checks that anchors resolve, so judge what's missing);
- each claim about code holds at the code;
- the doc follows `docs/implementation/conventions.md`: section order, naming, identifiers.

Also read: `docs/implementation/conventions.md`, and the canon and code the docs cite.

**set.** Read the slice docs as one set. Check that each uses every contract exactly as the milestone doc pins it, that each Scope: out names a slice whose Scope: in has that item, that Depends on and Blocks match the graph, and that the Definition of done is reachable from the docs as written. Also read: nothing further unless a claim needs it.
