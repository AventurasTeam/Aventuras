# Execution Plan Template

Copy this template into `.impl-plans/<milestone>-<slice-file-stem>.md`
(see `SKILL.md` → Draft The Plan for the naming rule).

```markdown
# M01/02-drizzle-schema Execution Plan

Status: draft
Slice: [Slice 1.2](../docs/implementation/milestones/01-spine/slices/02-drizzle-schema.md)
Milestone: [Milestone 1](../docs/implementation/milestones/01-spine/milestone.md)

<!-- When State is not `ready`, open the plan with a blockquote
callout: why it is not approvable, linking to ## Resolution Path. -->

## Readiness

- State: ready | needs-developer-decision | needs-design |
  needs-slice-amendment | blocked
- Dependencies:
- Worktree:
- Required reading (checked):
- Execution gate: none, or a condition that must hold before
  execution starts (e.g. "Slice 1.1 merged")
- Blockers:

## Resolution Path

Omit when State is `ready`. Names the obstacle and how the plan
becomes executable.

- Obstacle:
- Resolution owner: developer | aventuras-design session | dependency
  author | environment
- Resolution action:
- Resumption: re-plan, or clear the gate (flip Status) — which and why
- Resumes when:

For `needs-slice-amendment`, replace the bullets with a
section-by-section punch list — Goal, Scope: in, Scope: out,
Acceptance criteria, Tests, Open questions, milestone knock-on — each
stating what is wrong and what it becomes.

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
