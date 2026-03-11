# Roadmap: Eliminate Pre-Formatted Prompts

## Overview

This roadmap converts Aventura's AI prompt pipeline from pre-formatted TypeScript strings to raw structured data rendered by Liquid templates. The work proceeds foundation-first (types, registry, compat infrastructure), then converts each data domain (world state, lorebook, chapters, style, features), tackles the biggest behavioral change (narrative user content) once dependencies are stable, and finishes with compatibility shim validation. Each phase produces a working system.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - TypeScript interfaces, variable registry, sample context, compat shim module shell (completed 2026-03-10)
- [x] **Phase 2: World State Context** - Replace tieredContextBlock with typed arrays and template formatting
- [x] **Phase 3: Lorebook and Style** - Replace lorebook context blocks and style guidance with structured data
- [x] **Phase 4: Chapters and Feature Instructions** - Replace chapter summaries block and embed feature instructions in templates (completed 2026-03-11)
- [ ] **Phase 5: Narrative User Content** - New userContent templates replacing buildUserPrompt and buildPrimingMessage
- [ ] **Phase 6: Compatibility Shims** - Lazy shim computation, deprecation warnings, default template validation

## Phase Details

### Phase 1: Foundation

**Goal**: All new data types are defined, the variable registry and sample context reflect the target state, and the compat shim module exists ready to receive shim logic
**Depends on**: Nothing (first phase)
**Requirements**: META-01, META-02, META-03, META-04, COMPAT-05
**Success Criteria** (what must be TRUE):

1. TypeScript interfaces exist for all new array element types (worldStateCharacters, lorebookEntries, chapters, timelineFill, storyEntries, styleOverusedPhrases) with no `any`
2. Variable registry lists all new variables with element field descriptions visible in CodeMirror autocomplete tooltips, and old variables are marked deprecated
3. Sample context in the template editor preview shows realistic structured fake data for all new variables
4. A `compatShims.ts` module exists at `src/lib/services/context/` as the designated home for all backward-compatibility logic
   **Plans:** 2/2 plans complete

Plans:

- [x] 01-01-PLAN.md — Type definitions, variable registry, sample context, compat shim shell
- [x] 01-02-PLAN.md — Rich CodeMirror tooltips and deprecated variable UX

### Phase 2: World State Context

**Goal**: World state data reaches templates as typed arrays that templates format into the familiar section structure
**Depends on**: Phase 1
**Requirements**: WSC-01, WSC-02, WSC-03, WSC-04, WSC-05
**Success Criteria** (what must be TRUE):

1. `EntryInjector.buildContextBlock()` is deleted and `tieredContextBlock` string is no longer built in TypeScript
2. Templates receive `worldStateCharacters[]`, `worldStateInventory[]`, `worldStateBeats[]`, `worldStateLocations[]` as typed arrays
3. Character entries include `appearance: string[]` normalized from both VisualDescriptors objects and legacy array formats
4. Adventure and creative-writing templates render world state sections ([CURRENT LOCATION], [KNOWN CHARACTERS], [INVENTORY], [ACTIVE THREADS], etc.) from the structured arrays
5. Current location includes description (as object or separate variable)
   **Plans:** 2/2 plans executed

Plans:

- [x] 02-01-PLAN.md — World state mapper function, updated context types, new variable registry entries
- [x] 02-02-PLAN.md — Pipeline wiring, template conversion, buildContextBlock deletion

### Phase 3: Lorebook and Style

**Goal**: Lorebook entries and style review data reach templates as structured arrays, replacing both narrative and action-choices/suggestions pre-formatted blocks
**Depends on**: Phase 1
**Requirements**: LORE-01, LORE-02, LORE-03, LORE-04, LORE-05, STYLE-01, STYLE-02, STYLE-03
**Success Criteria** (what must be TRUE):

1. `EntryRetrievalService.buildContextBlock()` is deleted; `lorebookEntries[]` is passed as raw Entry array with tier metadata
2. ActionChoicesService and SuggestionsService receive the same `lorebookEntries[]` variable instead of pre-formatted `lorebookContext`
3. Narrative templates format lorebook grouped by type; action-choices and suggestions templates format as flat list
4. `retrievedChapterContext` is decomposed: lorebook portion is structured data, agentic retrieval is a separate `agenticRetrievalContext` string variable
5. `StyleReviewerService.formatForPromptInjection()` is no longer used; `styleOverusedPhrases[]` array is passed and templates format style avoidance sections
   **Plans:** 3/3 plans executed (2 executed, 1 gap closure)

Plans:

- [x] 03-01-PLAN.md — Lorebook mapper, ContextLorebookEntry update, variable registry and sample context
- [x] 03-02-PLAN.md — Pipeline wiring, RetrievalPhase decomposition, template lorebook and style sections
- [x] 03-03-PLAN.md — Gap closure: wire allSamples into TemplatePreview for structured preview rendering

### Phase 4: Chapters and Feature Instructions

**Goal**: Chapter history and feature instruction text are fully template-controlled -- chapters as structured data, feature instructions as static conditional template content
**Depends on**: Phase 1
**Requirements**: CHAP-01, CHAP-02, CHAP-03, CHAP-04, FEAT-01, FEAT-02, FEAT-03, FEAT-04, FEAT-05
**Success Criteria** (what must be TRUE):

1. `buildChapterSummariesBlock()` is deleted from NarrativeService; `chapters[]` and `timelineFill[]` arrays are passed to context
2. Adventure, creative-writing, and memory templates build the `<story_history>` block using `{% for %}` loops over chapters and timelineFill
3. `INLINE_IMAGE_INSTRUCTIONS` and `VISUAL_PROSE_INSTRUCTIONS` constants are removed from NarrativeService
4. Inline image and visual prose instruction text is embedded as static conditional content in adventure and creative-writing templates, gated by `{% if inlineImageMode %}` and `{% if visualProseMode %}`
5. `inlineImageInstructions` and `visualProseInstructions` variables are removed from ContextBuilder injection
   **Plans:** 2/2 plans complete

Plans:

- [x] 04-01-PLAN.md — Chapter mapper, pipeline wiring, template chapter rendering
- [x] 04-02-PLAN.md — Feature instruction embedding in templates, injection removal

### Phase 5: Narrative User Content

**Goal**: The narrative user message (priming text + story entries) is fully template-controlled via new editable userContent templates
**Depends on**: Phases 2, 3, 4
**Requirements**: USER-01, USER-02, USER-03, USER-04, USER-05, USER-06
**Success Criteria** (what must be TRUE):

1. `NarrativeService.buildUserPrompt()` is deleted; user prompt content comes from a rendered template
2. `NarrativeService.buildPrimingMessage()` and all 6 pov/tense variant methods are deleted
3. `storyEntries[]` array (with type and content fields) is passed to context, replacing `recentContext` and `recentEntries` formatting
4. Adventure and creative-writing each have a `userContent` template that handles pov/tense-aware priming and entry formatting
5. Both userContent templates are visible and editable in the UI prompt editor
   **Plans**: TBD

Plans:

- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Compatibility Shims

**Goal**: User-customized templates referencing old variable names continue to work with lazy computation, deprecation warnings, and clean isolation
**Depends on**: Phases 2, 3, 4, 5
**Requirements**: COMPAT-01, COMPAT-02, COMPAT-03, COMPAT-04
**Success Criteria** (what must be TRUE):

1. Old pre-formatted variables (tieredContextBlock, chapterSummaries, styleGuidance, lorebookContext, recentContext, inlineImageInstructions, visualProseInstructions) are still available if a template references them
2. Shim variables are computed lazily -- only built when the template source contains the old variable name
3. Console logs a deprecation warning when a shim variable is used
4. All default built-in templates use only new structured variables; shims exist solely for user-customized templates
   **Plans**: TBD

Plans:

- [ ] 06-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6
(Phases 2, 3, 4 depend only on Phase 1 and could theoretically parallelize, but execute sequentially.)

| Phase                                | Plans Complete | Status      | Completed  |
| ------------------------------------ | -------------- | ----------- | ---------- |
| 1. Foundation                        | 2/2            | Complete    | 2026-03-10 |
| 2. World State Context               | 2/2            | Complete    | 2026-03-10 |
| 3. Lorebook and Style                | 3/3            | Complete    | 2026-03-11 |
| 4. Chapters and Feature Instructions | 2/2            | Complete    | 2026-03-11 |
| 5. Narrative User Content            | 0/?            | Not started | -          |
| 6. Compatibility Shims               | 0/?            | Not started | -          |
