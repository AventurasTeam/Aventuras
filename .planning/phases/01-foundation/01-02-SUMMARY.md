---
phase: 01-foundation
plan: 02
subsystem: ui
tags: [codemirror, autocomplete, svelte, templates, tooltips]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: VariableDefinition with infoFields/deprecated, VariableFieldInfo types, variableRegistry.getAll(), allSamples from sampleContext.ts
provides:
  - buildTooltipInfo function creating rich DOM-node tooltip callbacks for all variable types
  - Deprecated variable section grouping in CodeMirror autocomplete (rank 99)
  - CSS theme rules for tooltip components using app CSS variables
affects: [any future TemplateEditor changes, autocomplete UX, template authoring experience]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DOM manipulation in CodeMirror tooltip callbacks: build nodes with createElement/appendChild, never innerHTML or Svelte components"
    - "CompletionSection with high rank value (99) for pushing deprecated items to bottom of autocomplete"
    - "buildTooltipInfo returns a () => { dom: Node } callback (not the DOM directly) -- CM calls it lazily"

key-files:
  created: []
  modified:
    - src/lib/components/vault/prompts/TemplateEditor.svelte

key-decisions:
  - "ALL variables get rich DOM-node tooltips (not just arrays) -- consistent experience across all 5 themes"
  - "Deprecated section header + '(deprecated)' detail text + warning banner provides sufficient indication without monkey-patching CM rendering"
  - "maxWidth of .cm-tooltip.cm-completionInfo widened from 300px to 400px to accommodate array field code blocks"

patterns-established:
  - "Tooltip CSS: use app CSS variables (--muted-foreground, --popover-foreground, --border) not hardcoded colors"
  - "buildTooltipInfo is a plain function, not reactive -- runs in CM's DOM context outside Svelte"

requirements-completed: [META-04]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 1 Plan 2: Rich Tooltip Rendering for Template Editor Summary

**Rich DOM-node tooltips for all CodeMirror autocomplete variables including array field shapes, example values, enum lists, and deprecated warning banners with section grouping**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T15:30:47Z
- **Completed:** 2026-03-10T15:33:47Z
- **Tasks:** 1 of 2 complete (Task 2 is checkpoint:human-verify)
- **Files modified:** 1

## Accomplishments
- Added `buildTooltipInfo` helper that returns lazy DOM-node callback for CodeMirror's `info` field
- Array variables with infoFields show mini code block with field names, types, descriptions + usage hint
- Array variables without infoFields (e.g., styleOverusedPhrases) show usage hint only
- Text/number variables show example value sourced from allSamples (sampleContext.ts)
- Boolean variables show "Values: true / false"
- Enum variables show available values list
- Deprecated variables show yellow warning banner + grouped in "Deprecated" CompletionSection
- All CSS uses app theme variables for cross-theme compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement rich tooltip rendering and deprecated variable UX in TemplateEditor** - `e4c8c09` (feat)

**Plan metadata:** pending (awaiting human verification checkpoint)

## Files Created/Modified
- `src/lib/components/vault/prompts/TemplateEditor.svelte` - Added buildTooltipInfo, deprecatedSection, updated completions builder, added 6 CSS rule sets, widened info tooltip maxWidth to 400px

## Decisions Made
- ALL variables get rich DOM-node tooltips (consistent experience, plan confirmed this)
- Deprecated section header + `(deprecated)` detail text + warning banner sufficient without monkey-patching CM rendering
- `maxWidth` widened from 300px to 400px to accommodate array field code blocks

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Task 1 complete and committed
- Awaiting human visual verification of tooltip rendering across all 5 themes (Task 2 checkpoint)
- After verification, Plan 02 is complete and Phase 1 (Foundation) is finished

---
*Phase: 01-foundation*
*Completed: 2026-03-10*
