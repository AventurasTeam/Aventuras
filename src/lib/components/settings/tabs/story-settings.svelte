<script lang="ts">
  import { onDestroy } from 'svelte'
  import { story } from '$lib/stores/story.svelte'
  import { hasRequiredCredentials } from '$lib/services/ai/image'
  import { templateEngine } from '$lib/services/templates/engine'
  import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
  import WritingStyleFields from '$lib/components/shared/WritingStyleFields.svelte'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'

  // Static — defined at module scope so they aren't re-created per component instance
  const KNOWN_VARIABLES = new Set([
    'mode',
    'pov',
    'tense',
    'genre',
    'tone',
    'themes',
    'settingDescription',
    'visualProseMode',
    'inlineImageMode',
    'protagonistName',
    'protagonistDescription',
    'currentLocation',
    'storyTime',
    'tieredContextBlock',
    'retrievedChapterContext',
    'chapterSummaries',
    'styleGuidance',
    'inlineImageInstructions',
    'visualProseInstructions',
    'runtimeVars_characters',
    'runtimeVars_locations',
    'runtimeVars_items',
    'runtimeVars_storyBeats',
    'runtimeVars_protagonist',
  ])

  const VARIABLE_REFERENCE = [
    {
      group: 'Protagonist',
      vars: [
        { name: 'protagonistName', desc: "Protagonist's name as set in World" },
        { name: 'protagonistDescription', desc: "Protagonist's description from World" },
      ],
    },
    {
      group: 'World',
      vars: [
        { name: 'currentLocation', desc: 'Current location name' },
        { name: 'storyTime', desc: 'In-story time (Year, Day, Hour, Minute)' },
        { name: 'genre', desc: 'Story genre' },
        { name: 'tone', desc: 'Writing tone' },
        { name: 'settingDescription', desc: 'World description' },
      ],
    },
    {
      group: 'Memory & Context',
      vars: [
        { name: 'tieredContextBlock', desc: 'Recent story memory injected by the memory system' },
        { name: 'chapterSummaries', desc: 'Summaries of past chapters' },
        { name: 'retrievedChapterContext', desc: 'Retrieved chapter context from memory' },
        { name: 'styleGuidance', desc: 'Style review guidance (when style reviewer is active)' },
      ],
    },
    {
      group: 'Runtime Variables',
      vars: [
        { name: 'runtimeVars_characters', desc: 'Runtime variable values for all characters' },
        { name: 'runtimeVars_protagonist', desc: 'Runtime variable values for the protagonist' },
        { name: 'runtimeVars_locations', desc: 'Runtime variable values for all locations' },
        { name: 'runtimeVars_items', desc: 'Runtime variable values for all items' },
        { name: 'runtimeVars_storyBeats', desc: 'Runtime variable values for all story beats' },
      ],
    },
  ]

  // Defined as a plain const so Svelte doesn't parse {{ }} as template expressions
  const promptPlaceholder =
    'Leave empty to use the default pack template. Use {{ protagonistName }}, {{ currentLocation }}, etc.'

  // ── Reactive state ────────────────────────────────────────────────────────────

  const storySettings = $derived(story.currentStory?.settings ?? {})
  const imageGenEnabled = $derived(hasRequiredCredentials())

  // Track only customSystemPrompt so the effect below doesn't fire on unrelated
  // setting changes (tone, pov, etc.) and overwrite an unsaved draft.
  const savedCustomPrompt = $derived(story.currentStory?.settings?.customSystemPrompt)

  // Local draft — initialised and re-synced only when the saved value changes.
  // Two write sources (user input + external sync) make a writable $derived inapplicable.
  // eslint-disable-next-line svelte/prefer-writable-derived
  let customPromptDraft = $state('')
  $effect(() => {
    customPromptDraft = savedCustomPrompt ?? ''
  })

  let validationResult = $state<{ success: boolean; error?: string } | null>(null)
  let unknownVars = $state<string[]>([])
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let showVarReference = $state(false)

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  // ── Derived flags ─────────────────────────────────────────────────────────────

  const isActive = $derived(!!savedCustomPrompt)
  const isDirty = $derived(customPromptDraft !== (savedCustomPrompt ?? ''))
  const canSave = $derived(
    isDirty && (customPromptDraft.trim() === '' || (validationResult?.success ?? false)),
  )

  // ── Functions ─────────────────────────────────────────────────────────────────

  function validate(value: string) {
    if (!value.trim()) {
      validationResult = null
      unknownVars = []
      return
    }
    const result = templateEngine.parseTemplate(value)
    validationResult = result
    unknownVars = result.success
      ? templateEngine.extractVariableNames(value).filter((v) => !KNOWN_VARIABLES.has(v))
      : []
  }

  function onDraftInput(value: string) {
    customPromptDraft = value
    validationResult = null // clear stale result immediately so canSave goes false until debounce fires
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => validate(value), 300)
  }

  function loadCurrentTemplate() {
    if (debounceTimer) clearTimeout(debounceTimer)
    const mode = story.currentStory?.mode ?? 'adventure'
    const templateId = mode === 'creative-writing' ? 'creative-writing' : 'adventure'
    const template = PROMPT_TEMPLATES.find((t) => t.id === templateId)
    if (template) {
      customPromptDraft = template.content
      validate(template.content)
    }
  }

  async function savePrompt() {
    await story.updateStorySettings({ customSystemPrompt: customPromptDraft.trim() || undefined })
  }

  async function clearOverride() {
    customPromptDraft = ''
    validationResult = null
    unknownVars = []
    await story.updateStorySettings({ customSystemPrompt: undefined })
  }
</script>

<div class="space-y-6">
  <div>
    <h3 class="text-lg font-semibold">Story Settings</h3>
    <p class="text-muted-foreground text-sm">Configure settings for the current story.</p>
  </div>

  <WritingStyleFields
    selectedPOV={storySettings.pov ?? 'second'}
    selectedTense={storySettings.tense ?? 'present'}
    tone={storySettings.tone ?? ''}
    visualProseMode={storySettings.visualProseMode ?? false}
    imageGenerationEnabled={imageGenEnabled}
    imageGenerationMode={storySettings.imageGenerationMode ?? 'none'}
    backgroundImagesEnabled={storySettings.backgroundImagesEnabled ?? false}
    referenceMode={storySettings.referenceMode ?? false}
    onPOVChange={(v) => story.updateStorySettings({ pov: v })}
    onTenseChange={(v) => story.updateStorySettings({ tense: v })}
    onToneChange={(v) => story.updateStorySettings({ tone: v })}
    onVisualProseModeChange={(v) => story.updateStorySettings({ visualProseMode: v })}
    onImageGenerationModeChange={(v) => story.updateStorySettings({ imageGenerationMode: v })}
    onBackgroundImagesEnabledChange={(v) =>
      story.updateStorySettings({ backgroundImagesEnabled: v })}
    onReferenceModeChange={(v) => story.updateStorySettings({ referenceMode: v })}
    disabledFields={{ pov: true, tense: true, visualProseMode: true }}
    disabledReason="Cannot be changed mid-story. Set during story creation."
  />

  <!-- ── Custom System Prompt ─────────────────────────────────────────────── -->
  <div class="border-t pt-4">
    <div class="mb-3 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <Label class="text-sm font-medium">Custom System Prompt</Label>
        {#if isActive}
          <span
            class="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
          >
            Active
          </span>
        {/if}
      </div>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={loadCurrentTemplate}>
          Load default template
        </Button>
        {#if isActive || customPromptDraft}
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive hover:text-destructive"
            onclick={clearOverride}
          >
            Clear override
          </Button>
        {/if}
      </div>
    </div>

    <p class="text-muted-foreground mb-3 text-xs">
      Replaces the default pack template for this story only. Supports Liquid template variables.
      Changes take effect on the next generation — no restart needed.
    </p>

    <Textarea
      value={customPromptDraft}
      oninput={(e) => onDraftInput((e.currentTarget as HTMLTextAreaElement).value)}
      class="min-h-[200px] font-mono text-xs"
      placeholder={promptPlaceholder}
    />

    <!-- Validation status -->
    {#if customPromptDraft.trim()}
      <div class="mt-2 space-y-1">
        {#if validationResult === null}
          <p class="text-muted-foreground text-xs">Validating…</p>
        {:else if validationResult.success}
          <p class="text-xs text-green-600 dark:text-green-400">✓ Template is valid</p>
        {:else}
          <p class="text-destructive text-xs">✕ Syntax error: {validationResult.error}</p>
        {/if}

        {#if unknownVars.length > 0}
          <p class="text-xs text-amber-600 dark:text-amber-400">
            ⚠ Unknown variables (will render empty):
            {#each unknownVars as v, i (v)}
              <code class="font-mono">{v}</code>{i < unknownVars.length - 1 ? ', ' : ''}
            {/each}
            — these may be custom pack variables.
          </p>
        {/if}
      </div>
    {/if}

    <!-- Save / status row -->
    {#if isDirty}
      <div class="mt-3 flex items-center justify-between gap-2">
        <p class="text-muted-foreground text-xs">Unsaved changes</p>
        <Button size="sm" onclick={savePrompt} disabled={!canSave}>Save</Button>
      </div>
    {/if}

    <!-- Variable reference (collapsible) -->
    <div class="mt-4">
      <button
        class="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
        onclick={() => (showVarReference = !showVarReference)}
        type="button"
      >
        <span>{showVarReference ? '▾' : '▸'}</span>
        Available template variables
      </button>

      {#if showVarReference}
        <div class="border-border mt-2 rounded-md border p-3 text-xs">
          {#each VARIABLE_REFERENCE as group (group.group)}
            <div class="mb-3 last:mb-0">
              <p
                class="text-muted-foreground mb-1 text-[0.65rem] font-semibold tracking-wide uppercase"
              >
                {group.group}
              </p>
              <div class="space-y-1">
                {#each group.vars as v (v.name)}
                  <div class="flex gap-2">
                    <code class="text-primary min-w-0 shrink-0 font-mono">{`{{ ${v.name} }}`}</code>
                    <span class="text-muted-foreground">{v.desc}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Tips -->
    <div class="border-border mt-4 space-y-2 rounded-md border border-dashed p-3 text-xs">
      <p class="font-medium">Tips</p>
      <ul class="text-muted-foreground list-disc space-y-1 pl-4">
        <li>
          This override applies to this story only. The default pack template is untouched and used
          by all other stories.
        </li>
        <li>
          Custom pack variables (defined in Vault → Prompts) are also available here. They will
          appear in the unknown variable warning below, but that's expected — they're resolved at
          generation time and will work correctly.
        </li>
        <li>
          For more advanced use cases — multiple template variants or sharing prompts across stories
          — consider creating a <strong>custom prompt pack</strong> in the Vault instead.
        </li>
      </ul>
    </div>
  </div>
</div>
