<script lang="ts">
  import { onMount } from 'svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { database } from '$lib/services/database'
  import { grammarService } from '$lib/services/grammar'
  import { THEMES } from '../../../../themes/themes'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import * as Select from '$lib/components/ui/select'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Badge } from '$lib/components/ui/badge'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Separator } from '$lib/components/ui/separator'
  import { getSupportedLanguages } from '$lib/services/ai/utils/TranslationService'
  import { updaterService } from '$lib/services/updater'
  import { RefreshCw, Loader2, Languages, Plus, X, Trash2 } from 'lucide-svelte'

  let isCheckingUpdates = $state(false)
  let updateMessage = $state<string | null>(null)
  let customDictionaryWords = $state<string[]>([])
  let customDictionaryInput = $state('')
  let loadingCustomDictionary = $state(false)
  let customDictionaryBusy = $state(false)

  onMount(() => {
    void loadCustomDictionary()
  })

  async function loadCustomDictionary() {
    loadingCustomDictionary = true
    try {
      customDictionaryWords = await grammarService.getCustomWords()
    } catch (error) {
      console.error('[Interface] Failed to load custom dictionary:', error)
      ui.showToast('Failed to load custom dictionary', 'error')
    } finally {
      loadingCustomDictionary = false
    }
  }

  async function handleAddCustomWord() {
    const input = customDictionaryInput
    if (!input.trim()) return

    customDictionaryBusy = true
    try {
      const result = await grammarService.addWord(input)
      if (result === 'added') {
        customDictionaryInput = ''
        customDictionaryWords = await grammarService.getCustomWords()
        ui.showToast('Word added to custom dictionary', 'info')
        return
      }

      if (result === 'exists') {
        ui.showToast('Word is already in your custom dictionary', 'warning')
        return
      }

      ui.showToast('Only single words can be added to the dictionary', 'warning')
    } catch (error) {
      console.error('[Interface] Failed to add custom dictionary word:', error)
      ui.showToast('Failed to add word to dictionary', 'error')
    } finally {
      customDictionaryBusy = false
    }
  }

  function handleCustomDictionaryInputKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void handleAddCustomWord()
  }

  async function handleRemoveCustomWord(word: string) {
    customDictionaryBusy = true
    try {
      const result = await grammarService.removeWord(word)
      if (result === 'removed') {
        customDictionaryWords = await grammarService.getCustomWords()
        return
      }

      if (result === 'not_found') {
        customDictionaryWords = await grammarService.getCustomWords()
        ui.showToast('Word not found in custom dictionary', 'warning')
        return
      }

      ui.showToast('Invalid dictionary word', 'warning')
    } catch (error) {
      console.error('[Interface] Failed to remove custom dictionary word:', error)
      ui.showToast('Failed to remove word from dictionary', 'error')
    } finally {
      customDictionaryBusy = false
    }
  }

  async function handleClearCustomDictionary() {
    if (customDictionaryWords.length === 0) return
    const confirmed = confirm('Clear all custom dictionary words? This cannot be undone.')
    if (!confirmed) return

    customDictionaryBusy = true
    try {
      await grammarService.clearCustomWords()
      customDictionaryWords = []
      ui.showToast('Custom dictionary cleared', 'info')
    } catch (error) {
      console.error('[Interface] Failed to clear custom dictionary:', error)
      ui.showToast('Failed to clear custom dictionary', 'error')
    } finally {
      customDictionaryBusy = false
    }
  }

  async function handleCheckForUpdates() {
    isCheckingUpdates = true
    updateMessage = null
    try {
      const info = await updaterService.checkForUpdates()
      if (info.available) {
        updateMessage = `Update available: v${info.version}`
      } else {
        updateMessage = "You're up to date!"
      }
    } catch (error) {
      updateMessage = 'Failed to check for updates'
      console.error('[Interface] Update check failed:', error)
    } finally {
      isCheckingUpdates = false
    }
  }

  const fontSizes = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ] as const
</script>

<div class="space-y-4">
  <!-- Theme Selection -->
  <div>
    <Label class="mb-2 block">Theme</Label>
    <Select.Root
      type="single"
      value={settings.uiSettings.theme}
      onValueChange={(v) => settings.setTheme(v)}
    >
      <Select.Trigger class="h-10 w-full">
        {THEMES.find((t) => t.id === settings.uiSettings.theme)?.label ?? 'Select theme'}
      </Select.Trigger>
      <Select.Content>
        {#each THEMES as theme (theme.id)}
          <Select.Item value={theme.id} label={theme.label}>
            {theme.label}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
    <p class="text-muted-foreground mt-1 text-xs">
      {THEMES.find((t) => t.id === settings.uiSettings.theme)?.description ?? ''}
    </p>
  </div>

  <!-- Font Size -->
  <div>
    <Label class="mb-2 block">Font Size</Label>
    <Select.Root
      type="single"
      value={settings.uiSettings.fontSize}
      onValueChange={(v) => settings.setFontSize(v as 'small' | 'medium' | 'large')}
    >
      <Select.Trigger class="h-10 w-full">
        {fontSizes.find((s) => s.value === settings.uiSettings.fontSize)?.label ?? 'Select size'}
      </Select.Trigger>
      <Select.Content>
        {#each fontSizes as size (size.value)}
          <Select.Item value={size.value} label={size.label}>
            {size.label}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <!-- Word Count Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Word Count</Label>
      <p class="text-muted-foreground text-xs">
        Display current story word count in the status bar
      </p>
    </div>
    <Switch
      checked={settings.uiSettings.showWordCount}
      onCheckedChange={(v) => {
        settings.uiSettings.showWordCount = v
        database.setSetting('show_word_count', v.toString())
      }}
    />
  </div>

  <!-- Spellcheck Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Spellcheck</Label>
      <p class="text-muted-foreground text-xs">Grammar and spelling suggestions while typing</p>
    </div>
    <Switch
      checked={settings.uiSettings.spellcheckEnabled}
      onCheckedChange={(v) => settings.setSpellcheckEnabled(v)}
    />
  </div>

  <!-- Custom Dictionary -->
  <div class="space-y-3 rounded-lg border p-3">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <Label>Custom Dictionary</Label>
        <p class="text-muted-foreground text-xs">
          Permanently ignore these spellings ({customDictionaryWords.length} words)
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onclick={handleClearCustomDictionary}
        disabled={customDictionaryBusy || customDictionaryWords.length === 0}
      >
        <Trash2 class="mr-1.5 h-3.5 w-3.5" />
        Clear all
      </Button>
    </div>

    <div class="flex gap-2">
      <Input
        placeholder="Add custom word..."
        bind:value={customDictionaryInput}
        onkeydown={handleCustomDictionaryInputKeydown}
      />
      <Button
        variant="outline"
        size="icon"
        onclick={handleAddCustomWord}
        disabled={customDictionaryBusy || !customDictionaryInput.trim()}
        title="Add custom word"
      >
        <Plus class="h-4 w-4" />
      </Button>
    </div>

    {#if loadingCustomDictionary}
      <p class="text-muted-foreground text-xs">Loading dictionary...</p>
    {:else if customDictionaryWords.length === 0}
      <p class="text-muted-foreground text-xs">No custom words saved yet.</p>
    {:else}
      <ScrollArea class="h-24 w-full rounded-md border">
        <div class="flex flex-wrap gap-1 p-2">
          {#each customDictionaryWords as word (word)}
            <Badge variant="secondary" class="gap-1 pr-1">
              <span class="max-w-36 truncate">{word}</span>
              <button
                class="hover:text-destructive text-muted-foreground p-0 transition-colors"
                onclick={() => handleRemoveCustomWord(word)}
                title="Remove word"
                disabled={customDictionaryBusy}
              >
                <X class="h-3 w-3" />
              </button>
            </Badge>
          {/each}
        </div>
      </ScrollArea>
    {/if}
  </div>

  <!-- Suggestions Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Suggestions</Label>
      <p class="text-muted-foreground text-xs">
        Show AI-generated action choices and plot suggestions
      </p>
    </div>
    <Switch
      checked={!settings.uiSettings.disableSuggestions}
      onCheckedChange={(v) => settings.setDisableSuggestions(!v)}
    />
  </div>

  <!-- Action Prefixes Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Action Prefixes</Label>
      <p class="text-muted-foreground text-xs">Show Do/Say/Think buttons for input</p>
    </div>
    <Switch
      checked={!settings.uiSettings.disableActionPrefixes}
      onCheckedChange={(v) => settings.setDisableActionPrefixes(!v)}
    />
  </div>

  <!-- Show Reasoning Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Reasoning Block</Label>
      <p class="text-muted-foreground text-xs">Show thought process display</p>
    </div>
    <Switch
      checked={settings.uiSettings.showReasoning}
      onCheckedChange={(v) => settings.setShowReasoning(v)}
    />
  </div>

  <!-- Auto Scroll Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Auto Scroll</Label>
      <p class="text-muted-foreground text-xs">
        Automatically scroll to the latest message during generation
      </p>
    </div>
    <Switch
      checked={settings.uiSettings.autoScroll}
      onCheckedChange={(v) => settings.setAutoScroll(v)}
    />
  </div>

  <!-- Scroll to Top Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Floating Scroll to Top Button</Label>
      <p class="text-muted-foreground text-xs">
        Show a floating button to jump to the first story entry
      </p>
    </div>
    <Switch
      checked={settings.uiSettings.showScrollToTop}
      onCheckedChange={(v) => settings.setShowScrollToTop(v)}
    />
  </div>

  <!-- Scroll to Bottom Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Floating Scroll to Bottom Button</Label>
      <p class="text-muted-foreground text-xs">
        Show a floating button to jump to the latest story entry
      </p>
    </div>
    <Switch
      checked={settings.uiSettings.showScrollToBottom}
      onCheckedChange={(v) => settings.setShowScrollToBottom(v)}
    />
  </div>

  <!-- Translation Section -->
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <Languages class="text-muted-foreground h-4 w-4" />
      <Label class="text-base font-medium">Translation</Label>
    </div>

    <div class="flex items-center justify-between">
      <div>
        <Label>Enable Translation</Label>
        <p class="text-muted-foreground text-xs">
          Translate AI responses to your language while keeping English prompts for optimal LLM
          performance
        </p>
      </div>
      <Switch
        checked={settings.translationSettings.enabled}
        onCheckedChange={(v) => {
          settings.translationSettings.enabled = v
          settings.saveTranslationSettings()
        }}
      />
    </div>

    {#if settings.translationSettings.enabled}
      <!-- Target Language -->
      <div>
        <Label class="mb-2 block">Target Language</Label>
        <Select.Root
          type="single"
          value={settings.translationSettings.targetLanguage}
          onValueChange={(v) => {
            settings.translationSettings.targetLanguage = v
            settings.saveTranslationSettings()
          }}
        >
          <Select.Trigger class="h-10 w-full">
            {getSupportedLanguages().find(
              (l) => l.code === settings.translationSettings.targetLanguage,
            )?.name ?? 'Select language'}
          </Select.Trigger>
          <Select.Content class="max-h-60">
            {#each getSupportedLanguages() as lang (lang.code)}
              <Select.Item value={lang.code} label={lang.name}>
                {lang.name}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <p class="text-muted-foreground mt-1 text-xs">Language for translated content display</p>
      </div>

      <!-- Translate Narration -->
      <div class="flex items-center justify-between">
        <div>
          <Label>Translate Narration</Label>
          <p class="text-muted-foreground text-xs">
            Translate AI-generated story content after generation
          </p>
        </div>
        <Switch
          checked={settings.translationSettings.translateNarration}
          onCheckedChange={(v) => {
            settings.translationSettings.translateNarration = v
            settings.saveTranslationSettings()
          }}
        />
      </div>

      <!-- Translate User Input -->
      <div class="flex items-center justify-between">
        <div>
          <Label>Translate User Input</Label>
          <p class="text-muted-foreground text-xs">
            Translate your input to English before sending to the AI
          </p>
        </div>
        <Switch
          checked={settings.translationSettings.translateUserInput}
          onCheckedChange={(v) => {
            settings.translationSettings.translateUserInput = v
            settings.saveTranslationSettings()
          }}
        />
      </div>

      <!-- Translate World State -->
      <div class="flex items-center justify-between">
        <div>
          <Label>Translate World State</Label>
          <p class="text-muted-foreground text-xs">
            Translate character names, locations, and items in the UI
          </p>
        </div>
        <Switch
          checked={settings.translationSettings.translateWorldState}
          onCheckedChange={(v) => {
            settings.translationSettings.translateWorldState = v
            settings.saveTranslationSettings()
          }}
        />
      </div>
    {/if}
  </div>

  <Separator class="my-4" />

  <!-- Updates Section -->
  <div class="space-y-4">
    <Label class="text-base font-medium">Updates</Label>

    <!-- Check for Updates Button -->
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onclick={handleCheckForUpdates}
        disabled={isCheckingUpdates}
      >
        {#if isCheckingUpdates}
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          Checking...
        {:else}
          <RefreshCw class="mr-2 h-4 w-4" />
          Check for Updates
        {/if}
      </Button>
      {#if updateMessage}
        <span class="text-muted-foreground text-sm">{updateMessage}</span>
      {/if}
    </div>

    <!-- Check on Startup Toggle -->
    <div class="flex items-center justify-between">
      <div>
        <Label>Check on Startup</Label>
        <p class="text-muted-foreground text-xs">
          Automatically check for updates when the app starts
        </p>
      </div>
      <Switch
        checked={settings.updateSettings.autoCheck}
        onCheckedChange={(v) => settings.setAutoCheck(v)}
      />
    </div>

    <!-- Auto-download Updates Toggle -->
    <div class="flex items-center justify-between">
      <div>
        <Label>Auto-download Updates</Label>
        <p class="text-muted-foreground text-xs">
          Automatically download updates in the background
        </p>
      </div>
      <Switch
        checked={settings.updateSettings.autoDownload}
        onCheckedChange={(v) => settings.setAutoDownload(v)}
      />
    </div>
  </div>
</div>
