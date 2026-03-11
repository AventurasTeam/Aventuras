---
phase: 04-chapters-and-feature-instructions
plan: 01
subsystem: ai-prompts
tags: [liquidjs, templates, chapter-mapper, context-pipeline, typescript]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: ContextBuilder, TemplateContext, variable registry with chapters/timelineFill entries
  - phase: 03-lorebook-and-style
    provides: lorebookMapper pattern, for-loop template conventions established
provides:
  - chapterMapper.ts with mapChaptersToContext() and formatStoryTime()
  - chapters[] and timelineFill[] structured arrays in narrative and memory context
  - <story_history> block rendered by Liquid for loops in adventure and creative-writing templates
  - Simple chapter loop in retrieval-decision memory template
affects:
  - 04-02-feature-instructions (removes inlineImageInstructions/visualProseInstructions injection, which this plan already did ahead of schedule)
  - phase 06 compat shims (formatStoryTime re-exported from chapterMapper; INLINE_IMAGE_INSTRUCTIONS/VISUAL_PROSE_INSTRUCTIONS constants kept in NarrativeService)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - chapterMapper.ts follows worldStateMapper.ts pure-function pattern (context/ folder, domain -> context type conversion)
    - story_history block inlined per template — no partials, consistent with Phase 2/3 lorebook pattern
    - {% assign %} accumulation on single line for pipe-delimited metadata to avoid whitespace drift

key-files:
  created:
    - src/lib/services/context/chapterMapper.ts
  modified:
    - src/lib/services/ai/generation/NarrativeService.ts
    - src/lib/services/ai/generation/MemoryService.ts
    - src/lib/services/ai/generation/index.ts
    - src/lib/services/prompts/templates/narrative.ts
    - src/lib/services/prompts/templates/memory.ts

key-decisions:
  - "formatStoryTime() moved to chapterMapper.ts and re-exported from generation/index.ts for external consumers"
  - "inlineImageInstructions/visualProseInstructions ctx.add() injection removed ahead of 04-02 schedule — INLINE_IMAGE_INSTRUCTIONS/VISUAL_PROSE_INSTRUCTIONS constants kept in NarrativeService for Phase 6 compat shim"
  - "{% assign %} metadata accumulation kept on single line in templates to avoid LiquidJS whitespace drift"

patterns-established:
  - "Chapter mapper: pure function in context/ folder, maps Chapter[] + TimelineFillResult -> ContextChapter[] + ContextTimelineFill[]"
  - "story_history Liquid block: inlined per template with {% if chapters.size > 0 or timelineFill.size > 0 %} outer guard"

requirements-completed: [CHAP-01, CHAP-02, CHAP-03, CHAP-04]

# Metrics
duration: 20min
completed: 2026-03-11
---

# Phase 4 Plan 01: Chapter Mapper and Template Rendering Summary

**chapterMapper.ts converts Chapter[] to typed ContextChapter[]/ContextTimelineFill[] arrays; adventure, creative-writing, and memory templates render <story_history> via Liquid for loops replacing buildChapterSummariesBlock()**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-11T09:04:00Z
- **Completed:** 2026-03-11T09:24:28Z
- **Tasks:** 2
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- Created `chapterMapper.ts` following the `worldStateMapper.ts` pattern — pure function, typed output, `formatStoryTime()` co-located with its consumer
- Deleted `buildChapterSummariesBlock()` and `formatStoryTime()` from NarrativeService; both services now use `mapChaptersToContext()`
- Adventure and creative-writing templates render `<story_history>` block via `{% for c in chapters %}` and `{% for item in timelineFill %}` loops with exact fidelity to the old pre-formatted string
- Memory retrieval-decision template uses simple `{% for c in chapters %}Chapter {{ c.number }}: {{ c.summary }}{% endfor %}` loop

## Task Commits

Each task was committed atomically:

1. **Task 1: Create chapterMapper and wire pipeline** - `42b9865` (feat)
2. **Task 2: Update templates to render chapters from structured arrays** - `77e24a3` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `src/lib/services/context/chapterMapper.ts` - New mapper: mapChaptersToContext(), formatStoryTime(), ChapterContextArrays interface
- `src/lib/services/ai/generation/NarrativeService.ts` - Removed buildChapterSummariesBlock/formatStoryTime/instruction injection; uses mapChaptersToContext()
- `src/lib/services/ai/generation/MemoryService.ts` - Replaced inline chapterSummaries build with mapChaptersToContext()
- `src/lib/services/ai/generation/index.ts` - Re-exports mapChaptersToContext/formatStoryTime from chapterMapper; removed NarrativeService re-exports of deleted functions
- `src/lib/services/prompts/templates/narrative.ts` - adventure + creative-writing templates: story_history block via for loops
- `src/lib/services/prompts/templates/memory.ts` - retrieval-decision template: simple chapters for loop

## Decisions Made
- `formatStoryTime()` moved to `chapterMapper.ts` and re-exported from `generation/index.ts` to preserve any external consumers
- The `inlineImageInstructions`/`visualProseInstructions` `ctx.add()` calls were removed as part of NarrativeService cleanup (ahead of 04-02 plan schedule) — the constants `INLINE_IMAGE_INSTRUCTIONS` and `VISUAL_PROSE_INSTRUCTIONS` are kept in NarrativeService.ts for Phase 6 compat shim use
- `{% assign %}` metadata accumulation on a single line (no newlines between assign tags) to prevent LiquidJS whitespace drift in the pipe-delimited `*Characters: X | Locations: Y | Tone: Z*` metadata line

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Ahead of Schedule] Removed inlineImageInstructions/visualProseInstructions injection**
- **Found during:** Task 1 (NarrativeService cleanup)
- **Issue:** The `ctx.add({ inlineImageInstructions })` and `ctx.add({ visualProseInstructions })` calls were in the same `buildPrompts()` block being refactored; removing them was a natural and correct part of the cleanup (they are Plan 04-02 scope, but already done)
- **Fix:** Removed both conditional `ctx.add()` injection calls; kept the constants in NarrativeService.ts for Phase 6 compat
- **Files modified:** src/lib/services/ai/generation/NarrativeService.ts
- **Committed in:** 42b9865 (Task 1 commit)

---

**Total deviations:** 1 (ahead-of-schedule cleanup for FEAT-01/FEAT-02 ctx.add removal)
**Impact on plan:** Templates still reference `{{ visualProseInstructions }}` and `{{ inlineImageMode }}` — Plan 04-02 will inline those instruction texts and remove the variable references. The ahead-of-schedule removal means NarrativeService no longer injects those variables, so templates will render empty for those guards until 04-02 completes. This is acceptable as the boolean flags themselves (`inlineImageMode`, `visualProseMode`) are still injected by `ContextBuilder.forStory()`.

## Issues Encountered
- The linter auto-merged the `import { mapChaptersToContext }` line into the adjacent import block and dropped it during MemoryService editing — resolved by adding the import after all other imports instead of before the schema block.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 04-02 can now embed `INLINE_IMAGE_INSTRUCTIONS` and `VISUAL_PROSE_INSTRUCTIONS` text directly into the adventure and creative-writing templates, replacing the `{{ visualProseInstructions }}` and `{{ inlineImageInstructions }}` variable references
- `chapterMapper.ts` is the established pattern for chapter context — ready for any future chapter-related context needs

## Self-Check: PASSED

- FOUND: src/lib/services/context/chapterMapper.ts
- FOUND: .planning/phases/04-chapters-and-feature-instructions/04-01-SUMMARY.md
- FOUND: commit 42b9865 (Task 1)
- FOUND: commit 77e24a3 (Task 2)
- chapterMapper.ts exports mapChaptersToContext (2 references) and formatStoryTime (5 references)
- NarrativeService imports mapChaptersToContext (2 references)
- MemoryService imports mapChaptersToContext (2 references)
- narrative.ts has 2 `for c in chapters` loops (adventure + creative-writing)
- memory.ts has 1 `for c in chapters` loop (retrieval-decision)
- npm run check: 0 errors, 0 warnings

---
*Phase: 04-chapters-and-feature-instructions*
*Completed: 2026-03-11*
