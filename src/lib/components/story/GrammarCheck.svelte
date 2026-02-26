<script lang="ts">
  import { grammarService, type GrammarIssue } from '$lib/services/grammar'
  import { settings } from '$lib/stores/settings.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { AlertCircle, Check, X, Plus } from 'lucide-svelte'
  import { slide } from 'svelte/transition'

  interface Props {
    text: string
    onApplySuggestion: (newText: string) => void
  }

  let { text, onApplySuggestion }: Props = $props()

  let issues = $state<GrammarIssue[]>([])
  let _checking = $state(false)
  let expandedIssue = $state<number | null>(null)
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null

  // Check if spellcheck is enabled
  const spellcheckEnabled = $derived(settings.uiSettings.spellcheckEnabled)

  // Debounced lint check
  $effect(() => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout)
    }

    // Skip if spellcheck is disabled
    if (!spellcheckEnabled) {
      issues = []
      return
    }

    if (!text.trim()) {
      issues = []
      return
    }

    debounceTimeout = setTimeout(async () => {
      _checking = true
      try {
        issues = await grammarService.lint(text)
      } finally {
        _checking = false
      }
    }, 500)

    return () => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout)
      }
    }
  })

  function handleApplySuggestion(issue: GrammarIssue, suggestionIndex: number) {
    const suggestion = issue.suggestions[suggestionIndex]
    if (suggestion === undefined) return

    const before = text.slice(0, issue.start)
    const after = text.slice(issue.end)
    const newText = before + suggestion + after
    onApplySuggestion(newText)
    expandedIssue = null
  }

  async function handleAddToDictionary(issue: GrammarIssue) {
    const result = await grammarService.addWord(issue.problemText)
    if (result === 'added') {
      // Re-lint to remove the issue
      issues = await grammarService.lint(text)
      expandedIssue = null
      return
    }

    if (result === 'exists') {
      ui.showToast('Word is already in your custom dictionary', 'warning')
      issues = await grammarService.lint(text)
      expandedIssue = null
      return
    }

    ui.showToast('Only single words can be added to the dictionary', 'warning')
  }

  function handleDismiss(index: number) {
    issues = issues.filter((_, i) => i !== index)
    expandedIssue = null
  }

  function toggleIssue(index: number) {
    expandedIssue = expandedIssue === index ? null : index
  }
</script>

{#if issues.length > 0}
  <div class="space-y-1.5" transition:slide={{ duration: 150 }}>
    {#each issues as issue, index (issue.start + '-' + issue.end)}
      <div
        class="overflow-hidden rounded-lg border border-yellow-700/40 bg-yellow-900/20"
        transition:slide={{ duration: 150 }}
      >
        <!-- Issue header -->
        <div
          class="flex w-full cursor-pointer items-start gap-2 p-2 text-left transition-colors hover:bg-yellow-900/10 active:bg-yellow-900/20 sm:p-2"
          onclick={() => toggleIssue(index)}
          onkeydown={(e) => e.key === 'Enter' && toggleIssue(index)}
          role="button"
          tabindex="0"
        >
          <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span
                class="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400 sm:text-xs"
              >
                {issue.kind}
              </span>
              <span
                class="max-w-[150px] truncate text-[10px] text-yellow-300/80 sm:max-w-none sm:text-xs"
              >
                "{issue.problemText}"
              </span>
            </div>
            <p
              class="mt-0.5 line-clamp-2 text-[10px] text-yellow-200/70 sm:line-clamp-1 sm:text-xs"
            >
              {issue.message}
            </p>
          </div>
          <button
            class="-m-0.5 flex min-h-[28px] min-w-[28px] shrink-0 items-center justify-center rounded p-1.5 text-yellow-500/60 hover:bg-yellow-800/30 hover:text-yellow-400 active:bg-yellow-800/50"
            onclick={(e) => {
              e.stopPropagation()
              handleDismiss(index)
            }}
            title="Dismiss"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- Expanded content with suggestions -->
        {#if expandedIssue === index}
          <div
            class="border-t border-yellow-700/30 px-2 pt-1.5 pb-2"
            transition:slide={{ duration: 150 }}
          >
            {#if issue.suggestions.length > 0}
              <div class="flex flex-wrap gap-1.5 sm:gap-2">
                {#each issue.suggestions.slice(0, 5) as suggestion, suggestionIndex (suggestionIndex)}
                  <button
                    class="flex min-h-[32px] items-center gap-1 rounded border border-green-700/40 bg-green-900/30 px-2 py-1.5 text-[11px] text-green-300 transition-colors hover:bg-green-900/50 active:bg-green-900/60 sm:text-xs"
                    onclick={() => handleApplySuggestion(issue, suggestionIndex)}
                  >
                    <Check class="h-3 w-3 shrink-0" />
                    <span class="max-w-[120px] truncate sm:max-w-none"
                      >{suggestion || '(remove)'}</span
                    >
                  </button>
                {/each}
                {#if issue.kind.toLowerCase().includes('spell')}
                  <button
                    class="bg-surface-700 border-surface-600 text-surface-300 hover:bg-surface-600 active:bg-surface-500 flex min-h-[32px] items-center gap-1 rounded border px-2 py-1.5 text-[11px] transition-colors sm:text-xs"
                    onclick={() => handleAddToDictionary(issue)}
                    title="Add to dictionary"
                  >
                    <Plus class="h-3 w-3 shrink-0" />
                    <span class="whitespace-nowrap">Add to dictionary</span>
                  </button>
                {/if}
              </div>
            {:else}
              <p class="text-xs text-yellow-400/60 italic">No suggestions available</p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
