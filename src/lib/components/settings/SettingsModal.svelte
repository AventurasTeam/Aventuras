<script lang="ts">
  import { onMount } from 'svelte'
  import { getVersion } from '@tauri-apps/api/app'
  import { ui } from '$lib/stores/ui.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import {
    Settings2,
    RotateCcw,
    Loader2,
    Key,
    Cpu,
    Palette,
    Image,
    Volume2,
    Settings as SettingsIcon,
    FlaskConical,
  } from 'lucide-svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Tabs, TabsContent } from '$lib/components/ui/tabs'
  import { Button } from '$lib/components/ui/button'

  import { Separator } from '$lib/components/ui/separator'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Textarea } from '$lib/components/ui/textarea'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Toggle } from '$lib/components/ui/toggle'

  import ApiConnectionTab from './tabs/api-connection.svelte'
  import GenerationTab from './tabs/generation.svelte'
  import InterfaceTab from './tabs/interface.svelte'
  import ImagesTab from './tabs/images.svelte'
  import TTSSettings from './TTSSettings.svelte'
  import AdvancedSettings from './AdvancedSettings.svelte'
  import ExperimentalSettings from './ExperimentalSettings.svelte'
  const tabs = [
    { id: 'api', label: 'API', icon: Key },
    { id: 'generation', label: 'Generation', icon: Cpu },
    { id: 'interface', label: 'Interface', icon: Palette },
    { id: 'images', label: 'Images', icon: Image },
    { id: 'tts', label: 'TTS', icon: Volume2 },
    { id: 'advanced', label: 'Advanced', icon: SettingsIcon },
    { id: 'experimental', label: 'Labs', icon: FlaskConical },
  ] as const

  type SettingsTab =
    | 'api'
    | 'generation'
    | 'interface'
    | 'images'
    | 'tts'
    | 'advanced'
    | 'experimental'

  // Use the tab from UI store (allows navigation from outside, e.g., profile warning banner)
  let activeTab = $state<SettingsTab>(ui.settingsTab as SettingsTab)

  // Sync activeTab when modal opens with a specific tab requested
  $effect(() => {
    if (ui.settingsModalOpen && ui.settingsTab !== activeTab) {
      activeTab = ui.settingsTab as SettingsTab
    }
  })

  let manualBodyEditorOpen = $state(false)
  let manualBodyEditorTitle = $state('Manual Request Body')
  let manualBodyEditorValue = $state('')
  let manualBodyEditorSave = $state<(value: string) => void>((_) => {})

  let isResettingSettings = $state(false)

  // Swipe handling
  let touchStartX = $state(0)
  let touchStartY = $state(0)
  let touchEndX = $state(0)
  let touchEndY = $state(0)
  let isInteractiveTouch = $state(false)
  let slideDirection = $state<'left' | 'right' | 'none'>('none')
  const SWIPE_THRESHOLD = 50
  const DIAGONAL_TOLERANCE = 0.5

  function handleTouchStart(e: TouchEvent) {
    const touch = e.changedTouches[0]
    const target = e.target as HTMLElement
    const interactiveSelector =
      'input, textarea, select, [role="slider"], [role="switch"], button, a'

    isInteractiveTouch = !!target.closest(interactiveSelector)
    if (isInteractiveTouch) return

    touchStartX = touch.screenX
    touchStartY = touch.screenY
  }

  function handleTouchEnd(e: TouchEvent) {
    if (isInteractiveTouch) return

    const touch = e.changedTouches[0]
    touchEndX = touch.screenX
    touchEndY = touch.screenY
    handleSwipe()
    isInteractiveTouch = false
  }

  function handleSwipe() {
    const deltaX = touchEndX - touchStartX
    const deltaY = touchEndY - touchStartY
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)

    if (absDeltaX < SWIPE_THRESHOLD) return

    const diagonalRatio = absDeltaY / absDeltaX
    if (diagonalRatio > DIAGONAL_TOLERANCE) return

    const currentIndex = tabs.findIndex((t) => t.id === activeTab)
    if (deltaX > 0 && currentIndex > 0) {
      slideDirection = 'right'
      activeTab = tabs[currentIndex - 1].id
      ui.setSettingsTab(activeTab)
      setTimeout(() => (slideDirection = 'none'), 300)
    } else if (deltaX < 0 && currentIndex < tabs.length - 1) {
      slideDirection = 'left'
      activeTab = tabs[currentIndex + 1].id
      ui.setSettingsTab(activeTab)
      setTimeout(() => (slideDirection = 'none'), 300)
    }
  }

  function openManualBodyEditor(title: string, value: string, onSave: (next: string) => void) {
    manualBodyEditorTitle = title
    manualBodyEditorValue = value
    manualBodyEditorSave = onSave
    manualBodyEditorOpen = true
  }

  function closeManualBodyEditor() {
    manualBodyEditorOpen = false
    manualBodyEditorTitle = 'Manual Request Body'
    manualBodyEditorValue = ''
    manualBodyEditorSave = (_) => {}
  }

  function applyManualBodyEditor() {
    manualBodyEditorSave(manualBodyEditorValue)
    closeManualBodyEditor()
  }

  function safeClose() {
    if (isResettingSettings) return
    ui.closeSettings()
  }

  async function handleResetAll() {
    const confirmed = confirm(
      'Reset all settings to their default values?\n\nYour API key will be preserved, but all other settings (models, temperatures, prompts, UI preferences) will be reset.\n\nThis cannot be undone.',
    )
    if (!confirmed) return

    isResettingSettings = true
    try {
      await settings.resetAllSettings(true)
    } finally {
      isResettingSettings = false
    }
  }

  let appVersion = $state('')

  onMount(async () => {
    try {
      appVersion = await getVersion()
    } catch {
      appVersion = '0.0.0-dev'
    }
  })
</script>

<ResponsiveModal.Root open={ui.settingsModalOpen} onOpenChange={(v) => !v && safeClose()}>
  <ResponsiveModal.Content class="flex h-[90vh] max-w-6xl flex-col overflow-hidden p-0">
    <div
      class="text-muted-foreground/30 absolute top-1 left-2 z-[110] font-mono text-[10px] md:top-auto md:bottom-1"
    >
      v{appVersion}
    </div>
    <ResponsiveModal.Header class="px-6 pb-4">
      <div class="flex items-center gap-3">
        <div class="bg-primary/10 hidden h-10 w-10 items-center justify-center rounded-lg md:flex">
          <Settings2 class="text-primary h-5 w-5" />
        </div>
        <div class="flex-1 text-center md:text-left">
          <ResponsiveModal.Title class="text-2xl font-semibold sm:text-xl"
            >Settings</ResponsiveModal.Title
          >
          <p class="text-muted-foreground hidden text-sm md:block">
            Configure your Aventuras experience
          </p>
        </div>
      </div>
    </ResponsiveModal.Header>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <ScrollArea class="border-border bg-muted/30 hidden w-64 border-r md:block">
        <div class="space-y-1 p-4">
          {#each tabs as tab (tab.id)}
            <button
              class="hover:bg-accent/50 hover:text-foreground flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
              class:bg-accent={activeTab === tab.id}
              class:text-accent-foreground={activeTab === tab.id}
              class:text-muted-foreground={activeTab !== tab.id}
              onclick={() => {
                activeTab = tab.id
                ui.setSettingsTab(tab.id)
              }}
            >
              <tab.icon class="h-4 w-4" />
              {tab.label}
            </button>
          {/each}

          <Separator class="my-3" />

          <Button
            variant="destructive"
            class="w-full items-center justify-start"
            onclick={handleResetAll}
            disabled={isResettingSettings}
          >
            {#if isResettingSettings}
              <Loader2 class="h-4 w-4 animate-spin" />
              Resetting...
            {:else}
              <RotateCcw class="h-4 w-4" />
              Reset All
            {/if}
          </Button>
        </div>
      </ScrollArea>

      <ScrollArea
        class="flex-1"
        ontouchstart={handleTouchStart}
        ontouchend={handleTouchEnd}
        style="touch-action: pan-y pinch-zoom;"
      >
        <div class="mx-auto px-4 sm:p-6">
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              activeTab = v as any
              ui.setSettingsTab(v)
            }}
          >
            {#each tabs as tab (tab.id)}
              <TabsContent value={tab.id} class="mt-0">
                {#if activeTab === tab.id}
                  <div
                    class={slideDirection === 'left'
                      ? 'slide-in-right'
                      : slideDirection === 'right'
                        ? 'slide-in-left'
                        : ''}
                  >
                    {#if tab.id === 'api'}
                      <ApiConnectionTab />
                    {:else if tab.id === 'generation'}
                      <GenerationTab onOpenManualBodyEditor={openManualBodyEditor} />
                    {:else if tab.id === 'interface'}
                      <InterfaceTab />
                    {:else if tab.id === 'images'}
                      <ImagesTab />
                    {:else if tab.id === 'tts'}
                      <TTSSettings />
                    {:else if tab.id === 'advanced'}
                      <div class="space-y-6">
                        <AdvancedSettings />

                        <div
                          class="border-destructive/50 flex items-center justify-between rounded-lg border p-4"
                        >
                          <div class="space-y-0.5">
                            <p class="text-destructive font-medium">Reset All Settings</p>
                            <p class="text-muted-foreground text-xs">
                              Resets all settings to defaults. API key is preserved.
                            </p>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onclick={handleResetAll}
                            disabled={isResettingSettings}
                          >
                            {#if isResettingSettings}
                              <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                              Resetting...
                            {:else}
                              <RotateCcw class="mr-2 h-4 w-4" />
                              Reset
                            {/if}
                          </Button>
                        </div>
                      </div>
                    {:else if tab.id === 'experimental'}
                      <ExperimentalSettings />
                    {/if}
                  </div>
                {/if}
              </TabsContent>
            {/each}
          </Tabs>
        </div>
      </ScrollArea>
    </div>

    <div class="border-border bg-background border-t p-1 md:hidden">
      <div class="flex justify-center gap-0 overflow-x-auto pb-0.5">
        {#each tabs as tab (tab.id)}
          <Toggle
            pressed={activeTab === tab.id}
            onPressedChange={(pressed) => {
              if (pressed) {
                activeTab = tab.id
                ui.setSettingsTab(tab.id)
              }
            }}
            size="sm"
            class="shrink-0 px-2"
          >
            <tab.icon class="h-4 w-4" />
            <span
              class="overflow-hidden text-xs whitespace-nowrap transition-all duration-300 ease-in-out {activeTab ===
              tab.id
                ? 'max-w-20 opacity-100'
                : 'max-w-0 opacity-0'}"
            >
              {tab.label}
            </span>
          </Toggle>
        {/each}
      </div>
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

<Dialog.Root open={manualBodyEditorOpen} onOpenChange={closeManualBodyEditor}>
  <Dialog.Content class="flex max-h-[90vh] max-w-3xl flex-col">
    <Dialog.Header>
      <Dialog.Title>{manualBodyEditorTitle}</Dialog.Title>
      <Dialog.Description>
        Edit the manual request body. This overrides request parameters; messages and tools are
        managed by Aventuras.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-hidden py-4">
      <Textarea
        bind:value={manualBodyEditorValue}
        class="h-full min-h-[50vh] resize-none font-mono text-sm"
        placeholder="Enter JSON request body..."
      />
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={closeManualBodyEditor}>Cancel</Button>
      <Button onclick={applyManualBodyEditor}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .slide-in-right {
    animation: slideInRight 0.3s ease-out;
  }
  .slide-in-left {
    animation: slideInLeft 0.3s ease-out;
  }
  @keyframes slideInRight {
    from {
      opacity: 0;
      transform: translateX(30px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  @keyframes slideInLeft {
    from {
      opacity: 0;
      transform: translateX(-30px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
</style>
