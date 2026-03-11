# Requirements: Eliminate Pre-Formatted Prompts

**Defined:** 2026-03-10
**Core Value:** Every piece of data injected into an AI prompt is a raw value that Liquid templates format — no invisible TypeScript-built strings reach the model.

## v1 Requirements

### World State Context (tieredContextBlock replacement)

- [ ] **WSC-01**: `tieredContextBlock` string removed; `EntryInjector.buildContextBlock()` deleted
- [x] **WSC-02**: World state passed as typed arrays: `worldStateCharacters[]`, `worldStateInventory[]`, `worldStateBeats[]`, `worldStateLocations[]` (non-current locations from tier 2/3)
- [x] **WSC-03**: Current location already in context as `currentLocation` string — extended to include description (`currentLocationDescription`) or replaced with a full object
- [x] **WSC-04**: Character entries include tier, relationship, description, traits, and `appearance: string[]` (TS layer normalizes `VisualDescriptors` object → flat array of non-empty values; legacy array format also normalized)
- [ ] **WSC-05**: Templates format world state sections: `[CURRENT LOCATION]`, `[KNOWN CHARACTERS]`, `[INVENTORY]`, `[ACTIVE THREADS]`, `[RELEVANT LOCATIONS]`, `[RELEVANT ITEMS]`, `[RELATED STORY THREADS]` — same template used for both `adventure` and `creative-writing` (same entities in both modes)

### Lorebook Context

- [x] **LORE-01**: `EntryRetrievalService.buildContextBlock()` deleted; `lorebookEntries[]` passed as raw Entry array with tier metadata
- [x] **LORE-02**: `lorebookContext` in `ActionChoicesService` and `SuggestionsService` replaced with same `lorebookEntries[]` variable
- [x] **LORE-03**: `adventure` and `creative-writing` templates format lorebook entries as `[LOREBOOK CONTEXT]` grouped by type
- [x] **LORE-04**: `action-choices` and `suggestions` templates format lorebook entries as flat list (`## World Context`)
- [x] **LORE-05**: `retrievedChapterContext` (combined context passed to EntryInjector) decomposed — lorebook portion passed as structured data; agentic retrieval result passed separately (as a string variable `agenticRetrievalContext` — it is LLM-generated Q&A, harder to structure)

### Chapter History

- [x] **CHAP-01**: `buildChapterSummariesBlock()` deleted from NarrativeService
- [x] **CHAP-02**: `chapters[]` array passed to context with fields: number, title, summary, startTime, endTime, characters[], locations[], emotionalTone
- [x] **CHAP-03**: `timelineFill[]` array passed to context (from TimelineFillResult.responses): chapterNumbers[], query, answer
- [x] **CHAP-04**: `adventure`, `creative-writing`, and `memory` templates format `<story_history>` block using `{% for chapter in chapters %}` and `{% for item in timelineFill %}`

### Style Guidance

- [x] **STYLE-01**: `StyleReviewerService.formatForPromptInjection()` no longer used for template injection
- [x] **STYLE-02**: `styleOverusedPhrases[]` string array passed to context (from StyleReviewResult.phrases)
- [x] **STYLE-03**: `adventure`, `creative-writing`, and `action-choices` templates format the style avoidance section using `{% for phrase in styleOverusedPhrases %}`

### Feature Instructions

- [ ] **FEAT-01**: `INLINE_IMAGE_INSTRUCTIONS` constant removed from NarrativeService
- [ ] **FEAT-02**: `VISUAL_PROSE_INSTRUCTIONS` constant removed from NarrativeService
- [ ] **FEAT-03**: Inline image instruction text embedded as static conditional content in `adventure` and `creative-writing` templates, gated by `{% if inlineImageMode %}`
- [ ] **FEAT-04**: Visual prose instruction text embedded as static conditional content in `adventure` and `creative-writing` templates, gated by `{% if visualProseMode %}`
- [ ] **FEAT-05**: `inlineImageInstructions` and `visualProseInstructions` variables removed from ContextBuilder injection

### Narrative User Content

- [ ] **USER-01**: `NarrativeService.buildUserPrompt()` deleted
- [ ] **USER-02**: `NarrativeService.buildPrimingMessage()` and all 6 pov/tense variants deleted
- [ ] **USER-03**: `storyEntries[]` array passed to context: `Array<{type: 'user_action'|'narration', content: string}>` — replaces `recentContext` (ActionChoicesService) and `recentEntries` formatting (SuggestionsService)
- [ ] **USER-04**: `userContent` template added for `adventure` — covers pov/tense-aware priming text + entry formatting (`[ACTION]`/`[NARRATIVE]`, `## Recent Story:`, `## Current Action:`, `Continue the narrative:`)
- [ ] **USER-05**: `userContent` template added for `creative-writing` — covers pov/tense-aware priming text + entry formatting (`[DIRECTION]`/`[NARRATIVE]` labels)
- [ ] **USER-06**: Both userContent templates accessible and editable in the UI prompt editor

### Compatibility Shims (migration)

- [ ] **COMPAT-01**: Old pre-formatted variables (`tieredContextBlock`, `chapterSummaries`, `styleGuidance`, `lorebookContext`, `recentContext`, `inlineImageInstructions`, `visualProseInstructions`) continue to be computed and injected alongside the new structured arrays
- [ ] **COMPAT-02**: Shim computation is lazy — old variables are only built if the template source references them (scan for variable name in template string before computing)
- [ ] **COMPAT-03**: When a shim variable is used, a deprecation warning is logged to console: `[ContextBuilder] Template uses deprecated variable "tieredContextBlock" — migrate to structured arrays`
- [ ] **COMPAT-04**: Default built-in templates use only new structured variables; shims exist solely for user-customized templates
- [x] **COMPAT-05**: Shim layer is isolated in a single module (`src/lib/services/context/compatShims.ts`) for clean removal in a future version

### Sample Context & Registry

- [x] **META-01**: `sampleContext.ts` updated with structured fake arrays for all new variables: `worldStateCharacters`, `worldStateInventory`, `worldStateBeats`, `worldStateLocations`, `lorebookEntries`, `chapters`, `timelineFill`, `storyEntries`, `styleOverusedPhrases`
- [x] **META-02**: `variables.ts` registry updated: new variable definitions added, old pre-formatted variable entries marked as deprecated (not removed — shims keep them functional)
- [x] **META-03**: TypeScript interfaces defined for all new array element types (no `any`)
- [x] **META-04**: Variable registry entries for array variables include element field descriptions in `info` (shown in CodeMirror autocomplete tooltip) so template authors know available sub-fields (e.g., `worldStateCharacters — Array of {name, relationship, description, traits[], appearance[]}`)

## v2 Requirements

### Agentic Retrieval Context

- **AGENTIC-01**: `agenticRetrievalContext` (currently a formatted string) decomposed into structured Q&A array `agenticRetrievalResults[]`: Array<{query, answer, chapterRange}>
- **AGENTIC-02**: Templates format agentic retrieval results with proper structure

## Out of Scope

| Feature | Reason |
|---------|--------|
| `narrativeResponse` variable | This is raw narrative content, not a formatting block |
| Retrieval tier logic (tier1/tier2/tier3 selection algorithms) | Only the formatting layer changes, not the selection logic |
| New LiquidJS filters or engine changes | Existing features are sufficient |
| ActionChoicesService `styleGuidance` (player terse/verbose detection) | This is dynamic computed guidance, different from StyleReviewer; handled separately |
| ClassifierService, LoreManagementService, image generation prompts | Out of scope for v1; limited to NarrativeService, ActionChoicesService, SuggestionsService |
| Story mode gating of variables | Both adventure and creative-writing share same entity types; templates are identical |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| META-01 | Phase 1: Foundation | Complete |
| META-02 | Phase 1: Foundation | Complete |
| META-03 | Phase 1: Foundation | Complete |
| META-04 | Phase 1: Foundation | Complete |
| COMPAT-05 | Phase 1: Foundation | Complete |
| WSC-01 | Phase 2: World State Context | Pending |
| WSC-02 | Phase 2: World State Context | Complete |
| WSC-03 | Phase 2: World State Context | Complete |
| WSC-04 | Phase 2: World State Context | Complete |
| WSC-05 | Phase 2: World State Context | Pending |
| LORE-01 | Phase 3: Lorebook and Style | Complete |
| LORE-02 | Phase 3: Lorebook and Style | Complete |
| LORE-03 | Phase 3: Lorebook and Style | Complete |
| LORE-04 | Phase 3: Lorebook and Style | Complete |
| LORE-05 | Phase 3: Lorebook and Style | Complete |
| STYLE-01 | Phase 3: Lorebook and Style | Complete |
| STYLE-02 | Phase 3: Lorebook and Style | Complete |
| STYLE-03 | Phase 3: Lorebook and Style | Complete |
| CHAP-01 | Phase 4: Chapters and Feature Instructions | Complete |
| CHAP-02 | Phase 4: Chapters and Feature Instructions | Complete |
| CHAP-03 | Phase 4: Chapters and Feature Instructions | Complete |
| CHAP-04 | Phase 4: Chapters and Feature Instructions | Complete |
| FEAT-01 | Phase 4: Chapters and Feature Instructions | Pending |
| FEAT-02 | Phase 4: Chapters and Feature Instructions | Pending |
| FEAT-03 | Phase 4: Chapters and Feature Instructions | Pending |
| FEAT-04 | Phase 4: Chapters and Feature Instructions | Pending |
| FEAT-05 | Phase 4: Chapters and Feature Instructions | Pending |
| USER-01 | Phase 5: Narrative User Content | Pending |
| USER-02 | Phase 5: Narrative User Content | Pending |
| USER-03 | Phase 5: Narrative User Content | Pending |
| USER-04 | Phase 5: Narrative User Content | Pending |
| USER-05 | Phase 5: Narrative User Content | Pending |
| USER-06 | Phase 5: Narrative User Content | Pending |
| COMPAT-01 | Phase 6: Compatibility Shims | Pending |
| COMPAT-02 | Phase 6: Compatibility Shims | Pending |
| COMPAT-03 | Phase 6: Compatibility Shims | Pending |
| COMPAT-04 | Phase 6: Compatibility Shims | Pending |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap creation*
