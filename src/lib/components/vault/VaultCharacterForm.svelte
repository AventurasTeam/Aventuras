<script lang="ts">
  import type { VaultCharacter } from '#lib/types/index.ts'
  import { characterVault } from '#lib/stores/characterVault.svelte.ts'
  import { Bot } from '@lucide/svelte'
  import VaultCharacterFormFields from './VaultCharacterFormFields.svelte'
  import type { VaultCharacterInput } from '#lib/services/ai/sdk/schemas/vault.ts'
  import type { FocusedEntity } from '#lib/services/ai/vault/InteractiveVaultService.ts'
  import { untrack } from 'svelte'
  import { ui } from '#lib/stores/ui.svelte.ts'

  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import { Button } from '#lib/components/ui/button/index.ts'

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

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSubmit()
    }
  }
</script>

<ActionModal
  open={true}
  onCancel={onClose}
  title={isEditing ? 'Edit the character' : 'Create a character'}
  action={{
    label: isEditing ? 'Save' : 'Create character',
    disabled: !formData.name.trim(),
    onConfirm: () => void handleSubmit(),
  }}
  busy={saving}
  dirty={hasChanges}
  requireChange={isEditing}
  size="2xl"
>
  {#snippet headerAction(leaveFor: (next: () => void) => void)}
    {#if isEditing && onOpenAssistant}
      <!-- An alternative to editing by hand, so it sits by the title rather than in the form. -->
      <Button
        variant="outline"
        size="sm"
        class="gap-1.5"
        title="Ask assistant"
        aria-label="Ask assistant"
        disabled={saving}
        onclick={() => {
          if (!character) return
          const { id, name } = character
          // The assistant works on the stored character, so unsaved edits are asked about first.
          leaveFor(() =>
            onOpenAssistant({ entityType: 'character', entityId: id, entityName: name }),
          )
        }}
      >
        <Bot class="h-4 w-4" />
        <span class="hidden md:inline">Ask assistant</span>
      </Button>
    {/if}
  {/snippet}
  <VaultCharacterFormFields data={formData} onUpdate={(newData) => (formData = newData)} />
</ActionModal>

<svelte:window onkeydown={handleKeydown} />
