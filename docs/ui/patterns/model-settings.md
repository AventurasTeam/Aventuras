# Model settings form

The fields that set how a model is called: the model itself, its
sampling and limits, and the advanced payload. Two owners hold them, an
App Settings profile and a story's model override, with one shape
(`ModelSettings` in
[`data-model.md → App settings storage`](../../data-model.md#app-settings-storage)),
so one form edits both. The host wraps it: a profile card adds the
profile's name and description, an override row its `×` and its
collapsed summary.

Sister patterns:
[`provider-model-picker.md`](./provider-model-picker.md) (the model
field) and [`forms.md`](./forms.md) (the slider row, the segment
selector row, Select and the stacked-label rule at narrow widths).

Used by:

- [App Settings · Profiles → Narrative profile](../screens/app-settings/app-settings.md#narrative-profile-always-present)
- [App Settings · Profiles → Agent profiles](../screens/app-settings/app-settings.md#agent-profiles)
- [Story Settings · Models tab](../screens/story-settings/story-settings.md#models-tab--overrides-only)

## Fields

- **provider/model** —
  [ProviderModelPicker primitive](./provider-model-picker.md).
  Sets the provider and model. Trigger shows the modelId
  and capability icons; the open picker carries type-to-search,
  cross-provider Favorites, grouped provider sections, and a
  sticky-footer custom-add composer.
- **temperature** — 0–2 slider.
- **max output** — slider with `[✎ custom]` for direct numeric input
  beyond the slider's range. A muted line beneath gives the model's
  [context window](../screens/app-settings/app-settings.md#context-window)
  and its source (`Context window 65,536 · detected`, `· set by you`),
  or `Context window unknown · set it in Providers`. Max output is not
  checked against the window: it is a ceiling, and calls are checked
  on the prompt alone. A server that reserves max output within the
  window (vLLM) refuses a call whose prompt plus it overflows, and a
  model whose output cap sits below what is sent refuses it too, so
  where a call falls back to a default (a close step and the boundary
  call send 16,384) the user sets max output to fit
  ([`chapter-close.md → When a task stops`](../../memory/chapter-close.md#when-a-task-stops)).
- **thinking** — slider, **conditional** rendering rules:
  - Provider known + model supports → slider visible.
  - Provider known + model doesn't → slider hidden, info text
    `Reasoning: not supported`.
  - Capability data unavailable → slider visible, info text
    `Reasoning: capability data unavailable — slider applies if model supports it`.

  The rules follow the model the form holds, so picking another model
  re-evaluates them; the stored value stays.

- **timeout** — 5–300s slider, `[✎ custom]` for outliers. Unset by
  default: no limit, except the ten minutes of a classifier pass or a
  chapter close's call
  ([`memory/classifier.md → Failure policy`](../../memory/classifier.md#failure-policy)).
- **structured output** — agents only; not on narrative. `auto` /
  `force on` / `force off`:
  - **`auto`** uses capability data: model supports → force-on; model
    doesn't → force-off; data unavailable → force-off (conservative).
  - **force on / force off** override the auto logic.
- **Chapter close** — two segment selectors, the close's two switches
  ([`data-model.md`](../../data-model.md#app-settings-storage)
  `closeConversation` and `closeTools`), setting how a close uses the model,
  since the right shape depends on it
  ([`chapter-close.md → Conversations`](../../memory/chapter-close.md#conversations)):
  - **Conversation** (`split` / `single`): one conversation per task,
    or one for all of them. `single` needs a large window.
  - **Tools** (`separate` / `shared`): each task's own tools, or all of
    them on every task. `shared` keeps the chapter cached on more
    models, at some cost to a weak one. Disabled under `single`, where
    it has no effect.
- **Advanced — custom JSON payload** — collapsed by default. Per-field
  override merged on top of the constructed request payload. Any
  parameters we don't surface in UI (`top_k`, `seed`,
  `repetition_penalty`, etc.). JSON-validated; warning if invalid.

## Which fields an owner shows

| Owner                | Structured output | Chapter close | Everything else |
| -------------------- | ----------------- | ------------- | --------------- |
| Narrative profile    | —                 | —             | ✓               |
| Agent profile        | ✓                 | ✓             | ✓               |
| Narrative override   | —                 | —             | ✓               |
| Agent override       | ✓                 | —             | ✓               |
| `lore-mgmt` override | ✓                 | ✓             | ✓               |

An agent profile can serve any agent, so it shows the Chapter close
segments under a label that says they do nothing for any other agent.
An override serves one slot, so only the `lore-mgmt` row shows them,
with no such note. An unset field means the call's own fallback on
either owner.
