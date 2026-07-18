<script lang="ts">
  import type { VaultLorebook } from '$lib/types'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { cn } from '$lib/utils/cn'
  import VaultLorebookEditorContent from './VaultLorebookEditorContent.svelte'
  import type { FocusedEntity } from '$lib/services/ai/vault/InteractiveVaultService'
  import { ui } from '$lib/stores/ui.svelte'
  import { onDestroy } from 'svelte'

  interface Props {
    lorebook: VaultLorebook
    onClose: () => void
    onOpenAssistant?: (entity: FocusedEntity) => void
  }

  let { lorebook, onClose, onOpenAssistant }: Props = $props()

  async function handleSave(updated: VaultLorebook) {
    await lorebookVault.update(updated.id, updated)
  }

  let isOpen = $state(true)
  let closeCooldownActive = $state(false)
  let closeCooldownTimer: ReturnType<typeof setTimeout> | undefined = $state()
  const CLOSE_COOLDOWN_MS = 3000
  let contentHasChanges = $state(false)

  onDestroy(() => {
    clearTimeout(closeCooldownTimer)
  })

  function handleModalOpenChange(nextOpen: boolean) {
    if (nextOpen) return
    if (contentHasChanges) {
      if (closeCooldownActive) {
        clearTimeout(closeCooldownTimer)
        closeCooldownActive = false
        onClose()
      } else {
        closeCooldownActive = true
        isOpen = true
        ui.showToast(
          'Unsaved Changes — Press Escape or click outside again to discard changes',
          'warning',
        )
        closeCooldownTimer = setTimeout(() => {
          closeCooldownActive = false
        }, CLOSE_COOLDOWN_MS)
      }
    } else {
      onClose()
    }
  }
</script>

<ResponsiveModal.Root bind:open={isOpen} onOpenChange={handleModalOpenChange}>
  <ResponsiveModal.Content
    class={cn(
      'flex h-[100dvh] w-full flex-col overflow-hidden rounded-none p-0 transition-all duration-200 sm:h-[90vh] sm:max-w-6xl sm:rounded-lg',
    )}
  >
    <VaultLorebookEditorContent
      {lorebook}
      onSave={handleSave}
      {onClose}
      {onOpenAssistant}
      initialEntryIndex={null}
      bind:hasChanges={contentHasChanges}
    />
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
