# Researcher Dispatch Template

Use this template when dispatching a researcher (SKILL.md → Stage 3). The role (what to read, what to leave out, the digest's sections) is the `aventuras-milestone-researcher` agent's definition, `.claude/agents/aventuras-milestone-researcher.md` (Opus, effort `high`); this template is the per-domain part.

```
Dispatch the aventuras-milestone-researcher agent with:
  description: "Research M<N>: [domain]"
  prompt: |
    Milestone: M<N>, in docs/implementation/roadmap.md → [entry heading]
    Domain: [name]: [the systems it covers, in a sentence or two]
    Start from: [the canon and code you expect it needs; a start, not a limit]
    Write to: [absolute path of research-<domain>.md in the working directory]
    Repository: [absolute path], at [HEAD_SHA]
```

## The promises sweep

One researcher always takes this domain, in addition to the others. Its digest replaces the definition's sections with the ones below.

```
Dispatch the aventuras-milestone-researcher agent with:
  description: "Research M<N>: promises"
  prompt: |
    Milestone: M<N>, in docs/implementation/roadmap.md → [entry heading]
    Domain: promises made to this milestone.

    Earlier work defers to this milestone in places its roadmap entry may not carry. Find them:
    - Search docs/, lib/, app/, components/, hooks/, electron/ and e2e/ for "M<N>", its slice ids, and the words its systems go by, because not every deferral uses the number.
    - Read docs/implementation/triage.md, docs/followups.md and the revisit signals in docs/parked.md.
    - Read the Open questions of earlier slices that built what this milestone extends.

    Look hardest for work that stays silently inert until this milestone supplies it: hardcoded placeholders, stubs, dormant arms, settings with no writer. Nothing fails when one of those is missed.

    For each item give where it is, what's promised, whether the entry already carries it, and the system it belongs to. Recheck each claim against the code.

    Write these sections instead of the definition's: **Must land** (the milestone can't honestly ship without it), **May wait** (it can move on, and to where), **Already carried** (the entry has it; say if the entry's version is stale), **Dissolved** (no longer true, and why).

    Write to: [absolute path of research-promises.md in the working directory]
    Repository: [absolute path], at [HEAD_SHA]
```
