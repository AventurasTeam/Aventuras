<script lang="ts">
  import type { VaultCharacter } from '$lib/types'
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import { Loader2, Bot, X } from 'lucide-svelte'
  import VaultCharacterFormFields from './VaultCharacterFormFields.svelte'
  import type { VaultCharacterInput } from '$lib/services/ai/sdk/schemas/vault'
  import type { FocusedEntity } from '$lib/services/ai/vault/InteractiveVaultService'
  import { untrack, onDestroy } from 'svelte'
  import { ui } from '$lib/stores/ui.svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'

  interface Props {
    character?: VaultCharacter | null
    onClose: () => void
    onSaved?: (character: VaultCharacter) => void
    onOpenAssistant?: (entity: FocusedEntity) => void
  }

  let { character = null, onClose, onSaved, onOpenAssistant }: Props = $props()

  // Form state encapsulated in a single object for the fields component
  let formData = $state<VaultCharacterInput>(
    untrack(() => ({
      name: character?.name ?? '',
      description: character?.description ?? null,
      traits: character?.traits ?? [],
      visualDescriptors: character?.visualDescriptors ?? {},
      tags: character?.tags ?? [],
      portrait: character?.portrait ?? null,
    })),
  )

  let savedSnapshot = $state<string>(untrack(() => JSON.stringify(formData)))
  let saving = $state(false)
  let _error = $state<string | null>(null)
  let isOpen = $state(true)
  let closeCooldownActive = $state(false)
  let closeCooldownTimer: ReturnType<typeof setTimeout> | undefined = $state()
  const CLOSE_COOLDOWN_MS = 3000

  onDestroy(() => {
    clearTimeout(closeCooldownTimer)
  })

  const isEditing = $derived(!!character)
  const hasChanges = $derived(JSON.stringify(formData) !== savedSnapshot)

  // Sync form data when the vault store updates (e.g. after save, or from
  // external changes) so the editor stays current without closing.
  $effect(() => {
    if (!isEditing || !character) return
    const current = characterVault.getById(character.id)
    if (!current) return
    untrack(() => {
      const snapshot: VaultCharacterInput = {
        name: current.name,
        description: current.description ?? null,
        traits: [...current.traits],
        visualDescriptors: JSON.parse(JSON.stringify(current.visualDescriptors)),
        tags: [...current.tags],
        portrait: current.portrait ?? null,
      }
      if (JSON.stringify(snapshot) !== JSON.stringify(formData)) {
        formData = snapshot
        savedSnapshot = JSON.stringify(snapshot)
      }
    })
  })

  async function handleSubmit() {
    if (saving || (isEditing && !hasChanges)) return
    if (!formData.name.trim()) {
      _error = 'Name is required'
      return
    }

    saving = true
    _error = null

    try {
      if (isEditing && character) {
        await characterVault.update(character.id, {
          ...formData,
          name: formData.name.trim(),
          portrait: formData.portrait ?? null,
        })
        savedSnapshot = JSON.stringify(formData)
        onSaved?.(characterVault.getById(character.id)!)
        ui.showToast('Character saved', 'info')
      } else {
        const newCharacter = await characterVault.add({
          name: formData.name.trim(),
          description: formData.description,
          traits: formData.traits,
          visualDescriptors: formData.visualDescriptors,
          tags: formData.tags,
          portrait: formData.portrait ?? null,
          favorite: false,
          source: 'manual',
          originalStoryId: null,
          metadata: null,
        })
        onSaved?.(newCharacter)
        onClose()
      }
    } catch (e) {
      _error = e instanceof Error ? e.message : 'Failed to save character'
    } finally {
      saving = false
    }
  }

  function closeWithChanges() {
    if (closeCooldownActive) {
      clearTimeout(closeCooldownTimer)
      closeCooldownActive = false
      onClose()
    } else {
      closeCooldownActive = true
      ui.showToast('Unsaved Changes — Press close again to discard changes', 'warning')
      closeCooldownTimer = setTimeout(() => {
        closeCooldownActive = false
      }, CLOSE_COOLDOWN_MS)
    }
  }

  function handleCloseAttempt() {
    if (isEditing && hasChanges) {
      closeWithChanges()
    } else {
      onClose()
    }
  }

  function handleModalOpenChange(nextOpen: boolean) {
    if (nextOpen) return
    if (isEditing && hasChanges) {
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

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSubmit()
    }
  }
</script>

<ResponsiveModal.Root bind:open={isOpen} onOpenChange={handleModalOpenChange}>
  <ResponsiveModal.Content class="flex flex-col md:h-auto md:max-h-[90vh] md:max-w-150">
    <ResponsiveModal.Header title={isEditing ? 'Edit Character' : 'New Character'} />

    <div class="flex-1 overflow-y-auto px-4 sm:pr-4">
      <form
        id="character-form"
        onsubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        <VaultCharacterFormFields data={formData} onUpdate={(newData) => (formData = newData)} />
      </form>
    </div>

    <!-- Actions -->
    <ResponsiveModal.Footer class="gap-2 sm:gap-0">
      <div class="flex flex-1 items-center gap-2">
        {#if isEditing && onOpenAssistant}
          <Button
            variant="outline"
            class="w-full sm:w-auto"
            disabled={saving}
            onclick={() => {
              if (!character) return
              onOpenAssistant({
                entityType: 'character',
                entityId: character.id,
                entityName: character.name,
              })
            }}
          >
            <Bot class="h-4 w-4" />
            Ask Assistant
          </Button>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" onclick={handleCloseAttempt} disabled={saving}>
          <X class="h-4 w-4" />
          <span class="hidden sm:inline">Close</span>
        </Button>
        <Button
          type="submit"
          form="character-form"
          disabled={saving || !formData.name.trim() || (isEditing && !hasChanges)}
          class="w-full sm:w-auto"
        >
          {#if saving}
            <Loader2 class="h-4 w-4 animate-spin" />
          {/if}
          {isEditing ? 'Save Changes' : 'Create Character'}
        </Button>
      </div>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

<svelte:window onkeydown={handleKeydown} />
