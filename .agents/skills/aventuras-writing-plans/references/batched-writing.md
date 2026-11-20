# Batched writing

The procedure for a plan of more than five tasks, from [`SKILL.md`](../SKILL.md) → Batched writing.

**1. Skeleton.** Write the plan file with every section, but each task as a skeleton entry, then the Writer batches line. Write the Review Focus section now and put each line's test in the owning entry's Scope. A writer later turns each entry into the full task, seeing only the skeleton, the repository and canon, so the entry must decide everything that crosses tasks.

````markdown
### Task N: [Component Name]

**Model:** cheap | standard | capable — <one-line why>
**Verification:** automated | review — <one-line why>
**Canon:** [`docs/<area>/<doc>.md → <Section>`](../docs/<area>/<doc>.md#<section>) — <what this task implements from it>
**Depends on:** Task a (<what it uses from it>), … — or `none`

**Scope:** <what the task delivers and how its acceptance is shown: behaviour, edge cases and refusals that other tasks or the slice's acceptance criteria rely on. A paragraph, not steps.>

**Files:**

- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts`
- Test: `exact/path/to/file.test.ts`

**Interface:**

```ts
// The exported declarations this task adds or changes: exact names, signatures, types
// with their fields, constants with their values, component props.
```

**Shared resources:** <migration number, i18n namespace and keys, shared fixtures, barrel lines> — or `none`
````

The interfaces are the contract between writers working at the same time:

- Write them from the code at this commit. Every existing function, type or table an interface names or calls must exist with that shape: read it, don't recall it.
- Put cross-task behaviour in the owning task's Scope, not only in a type: who validates an input, who takes which lock, what a function returns when it refuses, what runs inside a transaction. A writer of a dependent task sees only the interface and the Scope.
- Name every shared resource once, in the task that owns it, so two writers never pick the same migration number or i18n key.

After the task list, add a **Writer batches** line: about four consecutive tasks per batch, tasks that edit the same file in one batch where you can, and for each batch the files it shares with other batches.

**2. Review and approval.** Run the Self-Review on the skeleton, then offer the Independent review on it: the reviewer checks the contract the writers build on, which is where a batched plan's cross-task errors live. Then show the developer the skeleton (the task list with tiers, and the batches) and wait for their approval. Fixing an interface now costs an edit; after the writers it costs a batch.

**3. Writers.** Dispatch the `aventuras-plan-writer` agent (`.claude/agents/aventuras-plan-writer.md`: Opus, effort `xhigh`) once per batch, with [`plan-writer-prompt.md`](../plan-writer-prompt.md). Writers run three at a time by default: before dispatching, tell the developer the number of batches and the concurrency, and let them change it. Each writer writes its tasks to `<plan-stem>.batch-<K>.md` next to the plan and replies with a report. Without Claude Code agent definitions (another harness), dispatch a general subagent whose prompt is that definition file's body followed by the filled template.

**4. Assembly.** Handle each report the way aventuras-receiving-code-review handles review feedback: check it against the code and canon before acting. In the M4.2b evaluation about four reports in ten were not real problems.

- A real interface problem: fix the skeleton entry, and rerun every batch whose tasks use that interface.
- A writer's correction of its own task's scope: keep it if it holds, and tell the developer.
- An open cross-task question: settle it, and fix the tasks it touches, by a small edit or by rerunning the batch.

Then replace each skeleton entry in the plan with its written task, delete the batch files, and run the Self-Review's placeholder scan and type consistency check across the whole plan: tasks use each other's interfaces as declared, and a task that edits a file an earlier task changed starts from what that task leaves there.
