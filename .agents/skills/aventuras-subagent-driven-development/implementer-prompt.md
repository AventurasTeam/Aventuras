# Implementer Dispatch Template

Use this template when dispatching an implementer subagent. The role (checking the task against canon before coding, test-first, when to ask, the report format) is the `aventuras-implementer` agent's definition, `.claude/agents/aventuras-implementer.md`; this template is the per-task part.

```
Dispatch the aventuras-implementer agent with:
  model: [the task's Model tier from the plan: cheap → haiku, standard → sonnet, capable → opus]
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N: [task name]

    ## Task Description

    [FULL TEXT of task from plan - paste it here, don't make subagent read file]

    ## Context

    [Scene-setting: where this fits, dependencies, architectural context]

    [Every answer that changed the task, quoted with its label]

    Work from: [directory]
```

The definition sets effort `high`. Haiku has no effort setting, so a `cheap` task runs without one.
