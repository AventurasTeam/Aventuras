<script lang="ts">
  import type { VaultScenario } from '$lib/types'
  import { scenarioVault } from '$lib/stores/scenarioVault.svelte'
  import { Save, MapPin, Loader2, Bot } from 'lucide-svelte'
  import VaultScenarioFormFields from './VaultScenarioFormFields.svelte'
  import type { VaultScenarioInput } from '$lib/services/ai/sdk/schemas/vault'
  import type { FocusedEntity } from '$lib/services/ai/vault/InteractiveVaultService'
  import { untrack } from 'svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'

  interface Props {
    scenario: VaultScenario
    onClose: () => void
    onOpenAssistant?: (entity: FocusedEntity) => void
  }

  let { scenario, onClose, onOpenAssistant }: Props = $props()

  // Form State encapsulated in a single object
  let formData = $state<VaultScenarioInput>(
    untrack(() => ({
      name: scenario.name,
      description: scenario.description,
      settingSeed: scenario.settingSeed,
      npcs: JSON.parse(JSON.stringify(scenario.npcs)),
      primaryCharacterName: scenario.primaryCharacterName,
      firstMessage: scenario.firstMessage,
      alternateGreetings: [...scenario.alternateGreetings],
      tags: [...scenario.tags],
    })),
  )

  const isCreating = $derived(scenario.name === '' && scenario.settingSeed === '')

  let saving = $state(false)
  let error = $state<string | null>(null)

  async function handleSave() {
    if (!formData.name.trim()) {
      error = 'Scenario name is required'
      return
    }

    saving = true
    error = null

    try {
      await scenarioVault.update(scenario.id, {
        ...formData,
        name: formData.name.trim(),
        metadata: {
          ...scenario.metadata,
          npcCount: formData.npcs.length,
          hasFirstMessage: !!formData.firstMessage,
          alternateGreetingsCount: formData.alternateGreetings?.length ?? 0,
        },
      })
      onClose()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save scenario'
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
  <ResponsiveModal.Content
    class="flex h-[95vh] flex-col overflow-hidden p-0 md:h-[85vh] md:max-w-4xl"
  >
    <ResponsiveModal.Header class="bg-muted/40 border-b px-6 py-4">
      <div class="flex items-center gap-3">
        <div class="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
          <MapPin class="text-primary h-5 w-5" />
        </div>
        <div>
          <h2 class="text-lg font-semibold">{isCreating ? 'New Scenario' : 'Edit Scenario'}</h2>
          <p class="text-muted-foreground text-sm">
            {isCreating
              ? 'Fill in the details to create your scenario.'
              : 'Modify your scenario settings and characters.'}
          </p>
        </div>
      </div>
    </ResponsiveModal.Header>

    <div class="flex flex-1 flex-col overflow-hidden">
      {#if error}
        <div class="px-6 py-2">
          <div
            class="bg-destructive/10 border-destructive/20 text-destructive flex items-center gap-2 rounded-md border p-3 text-sm"
          >
            <Loader2 class="h-4 w-4" />
            {error}
          </div>
        </div>
      {/if}

      <VaultScenarioFormFields data={formData} onUpdate={(newData) => (formData = newData)} />
    </div>

    <ResponsiveModal.Footer class="bg-muted/40 border-t px-6 py-4">
      <div class="flex w-full items-center justify-between gap-2">
        {#if !isCreating && onOpenAssistant}
          <Button
            variant="outline"
            disabled={saving}
            onclick={() =>
              onOpenAssistant({
                entityType: 'scenario',
                entityId: scenario.id,
                entityName: scenario.name,
              })}
          >
            <Bot class="h-4 w-4" />
            Ask Assistant
          </Button>
        {:else}
          <div></div>
        {/if}
        <div class="flex items-center gap-2">
          <Button variant="outline" onclick={onClose} disabled={saving}>Cancel</Button>
          <Button onclick={handleSave} disabled={saving || !formData.name.trim()}>
            {#if saving}
              <Loader2 class=" h-4 w-4 animate-spin" />
            {:else}
              <Save class=" h-4 w-4" />
            {/if}
            {isCreating ? 'Create Scenario' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
