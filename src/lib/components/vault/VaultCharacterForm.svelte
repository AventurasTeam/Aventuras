<script lang="ts">
  import type { VaultCharacter } from '$lib/types'
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import { Loader2, Bot } from 'lucide-svelte'
  import VaultCharacterFormFields from './VaultCharacterFormFields.svelte'
  import type { VaultCharacterInput } from '$lib/services/ai/sdk/schemas/vault'
  import type { FocusedEntity } from '$lib/services/ai/vault/InteractiveVaultService'
  import { untrack } from 'svelte'

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

  let saving = $state(false)
  let _error = $state<string | null>(null)

  const isEditing = $derived(!!character)

  async function handleSubmit() {
    if (!formData.name.trim()) {
      _error = 'Name is required'
      return
    }

    saving = true
    _error = null

    try {
      if (isEditing && character) {
        // Update existing
        await characterVault.update(character.id, {
          ...formData,
          name: formData.name.trim(),
          portrait: formData.portrait ?? null,
        })
        onSaved?.(characterVault.getById(character.id)!)
      } else {
        // Create new
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
      }
      onClose()
    } catch (e) {
      _error = e instanceof Error ? e.message : 'Failed to save character'
    } finally {
      saving = false
    }
  }
</script>

<ResponsiveModal.Root
  open={true}
  onOpenChange={(open) => {
    if (!open) onClose()
  }}
>
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
      <Button
        type="submit"
        form="character-form"
        disabled={saving || !formData.name.trim()}
        class="w-full"
      >
        {#if saving}
          <Loader2 class="h-4 w-4 animate-spin" />
        {/if}
        {isEditing ? 'Save Changes' : 'Create Character'}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
