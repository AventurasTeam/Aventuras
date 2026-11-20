# The Preflight Sweep

Part of aventuras-subagent-driven-development. A dispatched worker runs it once, before dispatching Task 1. A conflict an implementer finds mid-run costs a question while the run waits on it; found now, every question goes out at once and reaches the developer early.

Sweep the plan against canon and the code as they stand now; main may have moved since the plan was written, and a gated plan was written before the work it builds on merged. Read each task down to its Interface block, not its steps: holding every task's full text is what SKILL.md → Setup forbids. Write down what you checked as you check it:

- tasks that contradict each other, the plan's Global Constraints, or the slice doc's Scope and Acceptance criteria
- each task's **Canon:** sections: they exist, and still say what the task implements from them
- each task's Files and Interface blocks against the tree at HEAD: a file it modifies exists, a file it creates doesn't (unless an earlier task creates it), and what it consumes exists in the code or comes from an earlier task's Interface

The sweep's output is a table, not a verdict. One row for every pair of tasks that share a file or an interface: the two tasks, what one produces against what the other consumes, and what you found. One row for every task: its Canon, Files and Interface checks, and what you found. "The sweep is clean" without those rows is not a sweep you ran.

Write the table to the ledger. Settle what canon or the code settles, as `references/handling-reports.md` → NEEDS_CONTEXT does, and ledger each as `settled:` beside its row. Everything else goes in one question through the channel before Task 1, framed as SKILL.md → Dispatched worker says, with the tasks that depend on each item. Then dispatch Task 1, or the first task that depends on no open item. If the sweep is clean, proceed without comment. The review loop remains the net for conflicts that only emerge from implementation.
