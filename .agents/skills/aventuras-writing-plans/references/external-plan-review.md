# External plan review through Orca

**Orca only.** The external option of SKILL.md → Independent review, run as a supervised Orca worker in the current worktree. The reviewer can be any agent Orca knows, such as `omp`, `codex`, `opencode` or `claude`; a different model family is the reason to pick this route. The planning session acts as the worker's coordinator for this one task. Read `orca skills get orchestration` first if you haven't this session.

1. **Fill the brief** from [`plan-document-reviewer-prompt.md`](../plan-document-reviewer-prompt.md), with absolute paths. The review file is `<plan-stem>.plan-review.md` next to the plan. Save the filled brief next to it as `<plan-stem>.plan-review-brief.md`, and put in the spec only a pointer to it, so a long brief doesn't hit the spec's size budget.
2. **Bind a Run:** reuse the session's, or `orca orchestration run-create --objective "plan review" --json`.
3. **Start the reviewer:**

   ```bash
   orca orchestration worker-start --run <run> --worktree current --agent <id> \
     --task-title "plan review <milestone>/<stem>" \
     --spec "Target: the plan review brief at <brief path>. Change: follow it; read-only except the review file it names. Acceptance: the review file is written; worker_done carries its verdict and finding counts." \
     --json
   ```

   `--model <id> --effort <level>` apply only to Claude, Codex, Cursor, Antigravity and Muse. Other agents, OMP and opencode included, review with the model their own config sets.
4. **Wait in the background:** `orca orchestration check --run <run> --wait --types "worker_done,escalation,question" --timeout-ms 3300000 --json`. Answer a `question` with `orca orchestration reply --id <message_id> --body "<answer>"`, from the plan, the slice doc and canon; ask the developer when they don't settle it. Acknowledge each delivery with the next wait.
5. **On `worker_done`,** read the review file, then `orca orchestration worker-release --dispatch <id>`. If it reports `retained`, tell the developer which terminal stays open.

A reviewer that fails, or never writes the file, is not a pass: tell the developer, and offer the fresh-subagent route instead.
