# AI Services and Configuration

How a task picks its model, and where the numbers that govern it live.

## Agent Profiles and Service Resolution

Every AI task is a `ServiceId` — the keys of `DEFAULT_SERVICE_PRESET_ASSIGNMENTS` in
`src/lib/stores/settings.svelte.ts`: `classifier`, `lorebookClassifier`, `entryRetrieval`,
`worldStateInjection`, `characterCardImport`, `memory`, `chapterQuery`, `timelineFill`,
`suggestions`, `actionChoices`, `styleReviewer`, `loreManagement`, `agenticRetrieval`,
`interactiveVault`, `imageGeneration`, `bgImageGeneration`, plus the namespaced
`wizard:*` and `translation:*` families.

The translation family is one `ServiceId` per surface — `translation:narration`,
`translation:input`, `translation:ui`, `translation:suggestions`, `translation:actionChoices`,
`translation:wizard` — so each can run on its own model. Translation is non-fatal throughout: a
failed call leaves the original text in place.

Resolution is two hops, and conflating them is the usual source of confusion:

```text
ServiceId ──(servicePresetAssignments)──▶ presetId ──(generationPresets)──▶ GenerationPreset
```

A `GenerationPreset` is what the UI calls an **Agent Profile**: it carries the model, the API
profile, temperature and reasoning effort. Several services share one by default — everything
classification-shaped points at the `classification` preset, the memory pipeline at `memory`, and
so on — so retargeting one profile moves every service assigned to it.

Most services extend `BaseAIService`, which does nothing but hold the `ServiceId` and expose
`presetId`; the model is never hardcoded. **`narrative` is a preset id, not a `ServiceId`** —
`NarrativeService` does not extend `BaseAIService` and streams through `generate.ts` with
`presetId: 'narrative'` directly.

`ServiceFactory` is the only place services are constructed, so a new task needs a `ServiceId`
(i.e. an entry in `DEFAULT_SERVICE_PRESET_ASSIGNMENTS`), a factory method, and a settings entry,
in that order.

Defaults that both the settings store and `AI_CONFIG` need live in
`src/lib/services/ai/core/defaults.ts`, a leaf module that imports nothing — `core/config.ts`
imports the settings store, so the store cannot import back from it.

**Two rules keep that file the single source.** A constant a user can change — anything with
a control in Advanced Settings — goes there as a named `*_DEFAULTS` object; a constant that
guards a failure mode and has no control (`GREP_NOISE_RATIO`, `MAX_LIST_ENTRIES`,
`MAX_CHAPTER_QUERIES_*`) stays next to the code it protects, where the reasoning lives. And
**a consumer never writes `?? <default>`**: the store merges every block over its defaults
on load, so the key is always present, and a fallback at the call site is a second copy of
the number that nothing forces to agree. That form had put four stale values in the tree at
once — a `maxIterations` of 50 in the store, 3 in a constructor, 50 again in the slider.

## Reasoning Effort

Every question about thinking effort is answered by `src/lib/services/ai/core/reasoning.ts`, a
leaf module that imports only types. It exists because those questions were once answered in
seven places, and the copies drifted.

Three things about it are not obvious:

- **The disabled level is `'none'`, and `'Off'` is not a value.** The levels are the AI SDK's
  own names minus `provider-default`, which is why `'off'` was renamed in 0.7.x. The old
  spelling survives in exactly one place — `LEGACY_REASONING_OFF` in `settingsMigrations.ts` —
  because installs older than that have the literal string on disk, and refusing to read it
  would discard the user's setting and fall back to the legacy `enable_thinking` flag, which
  means `'high'`.
- **`'none'` is sent, not omitted.** It is the value that switches thinking off:
  NanoGPT documents `reasoning_effort: "none"` as the way to disable reasoning, and
  `@ai-sdk/openai-compatible` would _drop_ the parameter for `'none'` on its own `reasoning`
  field. That is why the effort travels in provider options, which take precedence. Omitting
  the parameter asks for the model's default instead — a different request.
- **Only NanoGPT's `:thinking` variants are `enforced`.** Those ids _are_ the reasoning model,
  so asking one for `'none'` is self-contradictory, and `clampReasoningToCapability` lifts it to
  `ENFORCED_REASONING_FLOOR` (`'medium'` — a floor, not a preference). Every other model that
  merely _supports_ reasoning can be turned off. Reading "supports" as "enforces" is what made
  reasoning impossible to disable on NanoGPT for an entire release: the UI learned the
  distinction while the store that forced the level did not.

`clampReasoningToCapability` is the single rule for what a capability does to a chosen level,
which is what keeps the settings effect that applies it two lines long and testable.

Alongside it, `sdk/presetResolution.ts` resolves preset → profile → model for all three
callers — the services, the narrator and the agent factory — plus `buildProviderOptions`,
`resolveStructuredOutputs` and `thinkingNudgeApplies`. Each of those was previously written
per-caller. The **Thinking nudge** setting needs all three of a think-tag provider, reasoning
on, and no native structured output; the UI asks the same predicate before offering the toggle,
so it cannot be switched on where it does nothing.
