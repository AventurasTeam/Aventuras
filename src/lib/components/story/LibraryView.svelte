<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { exportService } from '$lib/services/export'
  import { ask } from '@tauri-apps/plugin-dialog'
  import { BookOpen, Upload, RefreshCw, Archive, Plus, MessageSquareShare } from 'lucide-svelte'
  import SetupWizard from '../wizard/SetupWizard.svelte'
  import STImportWizard from '../wizard/STImportWizard.svelte'

  import { Button } from '$lib/components/ui/button'
  import EmptyState from '$lib/components/ui/empty-state/empty-state.svelte'
  import StoryCard from '$lib/components/story/StoryCard.svelte'

  // File input for import (HTML-based for mobile compatibility)
  let importFileInput: HTMLInputElement

  let showSetupWizard = $state(false)
  let setupWizardKey = $state(0)
  let showSTImportWizard = $state(false)
  let stImportWizardKey = $state(0)

  // Load stories on mount
  $effect(() => {
    story.loadAllStories()
  })

  function openSetupWizard() {
    setupWizardKey += 1
    showSetupWizard = true
  }

  function openSTImportWizard() {
    stImportWizardKey += 1
    showSTImportWizard = true
  }

  async function openStory(storyId: string) {
    ui.resetScrollBreak()
    await story.loadStory(storyId)
    ui.setActivePanel('story')
  }

  async function deleteStory(storyId: string, event: MouseEvent) {
    event.stopPropagation()
    const confirmed = await ask(
      'Are you sure you want to delete this story? This action cannot be undone.',
      {
        title: 'Delete Story',
        kind: 'warning',
      },
    )
    if (confirmed) {
      await story.deleteStory(storyId)
    }
  }

  function triggerImport() {
    importFileInput?.click()
  }

  async function handleImportFileSelect(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      const result = await exportService.importFromContent(content)

      if (result.success && result.storyId) {
        await story.loadAllStories()
        await story.loadStory(result.storyId)
        ui.setActivePanel('story')
      } else if (result.error) {
        ui.showToast(result.error, 'error')
      }
    } catch (error) {
      ui.showToast(error instanceof Error ? error.message : 'Failed to read file', 'error')
    }

    // Reset file input for re-selection
    input.value = ''
  }
</script>

<div class="bg-background relative h-full overflow-y-auto p-4 sm:p-6">
  <div class="mx-auto flex min-h-full max-w-5xl flex-col">
    <!-- Header -->
    <div class="mb-6 flex flex-row items-start justify-between gap-3 sm:mb-8 sm:gap-4">
      <div class="mr-2 min-w-0 flex-1">
        <h1 class="text-foreground truncate pb-1 text-xl font-bold tracking-tight sm:text-3xl">
          Story Library
        </h1>
        <p class="text-muted-foreground -mt-1 truncate text-sm sm:text-base">
          Your adventures await...
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Button
          icon={RefreshCw}
          label="Sync"
          variant="outline"
          title="Sync stories between devices"
          onclick={() => ui.openSyncModal()}
        />
        <Button
          icon={Archive}
          label="Vault"
          variant="outline"
          title="Vault"
          onclick={() => ui.setActivePanel('vault')}
        />
        <Button
          icon={Upload}
          label="Import"
          variant="outline"
          title="Import Story"
          onclick={triggerImport}
        />
        <input
          type="file"
          accept="*/*,.avt,.json,application/json,application/octet-stream"
          class="hidden"
          bind:this={importFileInput}
          onchange={handleImportFileSelect}
        />
        <Button
          icon={MessageSquareShare}
          label="ST Import"
          variant="outline"
          title="Import from SillyTavern"
          onclick={openSTImportWizard}
        />
        <Button
          variant="default"
          icon={Plus}
          label="New Story"
          title="New Story"
          onclick={openSetupWizard}
        />
      </div>
    </div>

    <!-- Stories grid -->
    {#if story.allStories.length === 0}
      <EmptyState
        icon={BookOpen}
        title="No stories yet"
        description="Create your first adventure to get started."
        actionLabel="Create Story"
        onAction={openSetupWizard}
        class="pb-20"
      />
    {:else}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {#each story.allStories as s (s.id)}
          <StoryCard story={s} onOpen={openStory} onDelete={deleteStory} />
        {/each}
      </div>
    {/if}
  </div>

  <!-- Discord Link -->
  <a
    href="https://discord.gg/aventuras"
    target="_blank"
    rel="noopener noreferrer"
    class="bg-secondary text-secondary-foreground hover:bg-secondary/80 fixed bottom-6 left-6 z-40 hidden items-center gap-2 rounded-lg px-3 py-2 text-sm shadow-lg transition-all hover:scale-105 sm:flex"
  >
    <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path
        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
      />
    </svg>
    <span class="hidden sm:inline">Official Aventuras Discord</span>
  </a>
</div>

<!-- Setup Wizard -->
{#if showSetupWizard}
  {#key setupWizardKey}
    <SetupWizard onClose={() => (showSetupWizard = false)} />
  {/key}
{/if}

<!-- ST Import Wizard -->
{#if showSTImportWizard}
  {#key stImportWizardKey}
    <STImportWizard onClose={() => (showSTImportWizard = false)} />
  {/key}
{/if}
