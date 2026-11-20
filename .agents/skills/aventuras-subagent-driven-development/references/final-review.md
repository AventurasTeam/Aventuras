# Final Review

Part of aventuras-subagent-driven-development. Every task in the plan is complete, and no question is open.

Dispatch the `aventuras-code-reviewer` agent over the whole branch (BASE = the commit the branch started from, e.g. `git merge-base origin/main HEAD`), using aventuras-requesting-code-review's [code-reviewer.md](../../aventuras-requesting-code-review/code-reviewer.md). Its requirements are the plan's path, the plan's Review Focus section as cases to check, each with the test the plan pinned to it, and the ledger's `minor (deferred)` lines, verbatim, so it can triage which must be fixed before merge. SKILL.md → The task review's dispatch rules hold here too. Ledger `final review <head7>`.

Route what it returns:

- **Outside this change** goes to `docs/implementation/triage.md`.
- **Declined to judge:** a line that a plan Decision, canon or a known-limitation list covers needs nothing more; ledger it with the citation. Every other line is a residual finding (below).
- **Issues:** if there are any, dispatch ONE fresh `aventuras-implementer` with the complete findings list, verbatim, and the plan's Global Constraints — not one fixer per finding. Per-finding fixers each rebuild context and re-run suites; a real session's final-review fix wave cost more than all its tasks combined. Name its model by SKILL.md's Model Selection, and give it the report file `<plan-stem>.final.report.md` next to the plan. Then run exactly one scoped re-review of the fix wave ([re-review-prompt.md](../re-review-prompt.md) over the fix range). There is no second fix wave.

Never rule on a residual finding yourself. Each one (a finding the re-review leaves open, new breakage it reports, a Declined to judge line nothing covers) goes:

- to the PR's Decisions pending when it is in this branch's own code: `<finding> → left as is (fix: <…>)`;
- to `docs/implementation/triage.md` when code this branch didn't write holds it, or a later slice owns it.

Ledger each with where it went. Attended, show your human partner the residual findings and the ledger's `settled:` entries before finishing presents its options: those are the decisions taken on their behalf. Then use aventuras-finishing-a-development-branch; a PR lists both.
