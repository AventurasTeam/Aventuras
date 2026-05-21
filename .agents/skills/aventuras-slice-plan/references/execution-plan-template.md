# Execution Plan Template

Copy this template into `.impl-plans/<milestone>-<slice-file-stem>.md`
(see `SKILL.md` → Draft The Plan for the naming rule).

```markdown
# M01/02-drizzle-schema Execution Plan

Status: draft
Slice: [Slice 1.2](../docs/implementation/milestones/01-spine/slices/02-drizzle-schema.md)
Milestone: [Milestone 1](../docs/implementation/milestones/01-spine/milestone.md)

## Readiness

- Dependencies:
- Worktree:
- Required reading:
- Blockers:

## Decisions

### Developer decisions

- Decision:
- Chosen:
- Rationale:

### Implementer choices

- Choice:
- Default:
- Rationale:

### Monitor during work

- Risk:
- Signal:
- Response:

## Implementation Strategy

- Modules / files:
- Public APIs:
- Data / migration shape:
- UI or Storybook surfaces:
- Error handling / rollback:
- Out of scope:

## Task Clusters

Batched by risk and verification boundary. Declare ordering with
`Depends on`; clusters with no edge between them are parallel-safe —
the execution skill decides how to dispatch them.

1. Cluster name
   - Goal:
   - Files:
   - Depends on:
   - Steps:
   - Verification:

## Evidence Matrix

| Acceptance criterion | Evidence                 | Command / check     |
| -------------------- | ------------------------ | ------------------- |
| ...                  | automated / manual / doc | `pnpm test:run ...` |

## Skill Plan

### Recommended During Execution

- Skill:
  - Trigger point:
  - Why:
  - May skip if:

### Not Needed

- Skill:
  - Reason:

## Stop Conditions

- Return to planning if:
- Recommend a developer-run `aventuras-design` session if:
- Recommend a developer-owned slice-doc amendment if:

## Approval

- Approved by:
- Date:
- Notes:
```

Keep the plan brief. Add detail where execution would otherwise have to
guess; omit research transcript and redundant slice-doc prose.
