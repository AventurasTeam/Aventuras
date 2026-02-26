# Implementation Plan: Force Reasoning (Local Thinking)

This plan outlines the steps to implement a "Force Reasoning" feature for local AI providers (Ollama, LM Studio, llama.cpp, etc.) using assistant pre-filling.

## 1. Data Model Updates (`src/lib/types/index.ts`)
- [ ] Add `forceReasoning: boolean` and `reasoningPreFill: string` to `APISettings`.
- [ ] Add `forceReasoning: boolean` and `reasoningPreFill: string` to `GenerationPreset`.
- [ ] Update `StorySettings` if necessary (optional, usually inherited from Global or Preset).

## 2. Logic Implementation (`src/lib/services/ai/sdk/generate.ts`)
- [ ] **Always-on Extraction**: Modify middleware builders (`buildStructuredMiddleware`, `buildPlainTextMiddleware`, `buildNarrativeMiddleware`) to include `thinkTagMiddleware` for all providers with `reasoningExtraction: 'think-tag'`, regardless of `reasoningEffort`.
- [ ] **Message Transformation Helper**: Create a utility to convert `system` + `prompt` into a `messages` array.
    - If `forceReasoning` is `true`, append an assistant message with the `reasoningPreFill` content.
- [ ] **Update Generate/Stream Functions**: Update `generateText` and `streamText` calls in `generateStructured`, `generatePlainText`, `streamPlainText`, `streamStructured`, and `streamNarrative` to use the `messages` array instead of the `prompt` parameter when applicable.

## 3. UI Updates (`src/lib/components/settings/`)
### MainNarrative.svelte
- [ ] Replace the simple toggle (added in previous step) with a dedicated "Force Reasoning" section for `heuristic` providers.
- [ ] Add description: "Encourages the model to start a chain of thought by pre-filling the start of the response."
- [ ] Add an input field for the pre-fill tag (default: `<think>`), visible only when `forceReasoning` is enabled.

### AgentProfiles.svelte
- [ ] Apply the same UI logic to the Profile Editor for individual agent tasks.

## 4. Verification & Testing
- [ ] Test with a local model (e.g., DeepSeek R1 via Ollama).
- [ ] Verify that the reasoning block (pulsing brain) appears correctly in the UI.
- [ ] Verify that the pre-filled tag does not appear twice or break the chat flow.
- [ ] Verify that disabling "Force Reasoning" still allows the UI to parse `<think>` tags if the model generates them spontaneously.

## 5. Implementation Strategy
- **Phase 1: Types & Storage**: Update interfaces and add settings persistence logic.
- **Phase 2: Core Logic**: Implement the message array transformation in `generate.ts`.
- **Phase 3: UI**: Build the settings controls.
- **Phase 4: Refinement**: Final polish of descriptions and validation.
