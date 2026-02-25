<script lang="ts">
  import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas/vault'
  import type { VaultCharacterInput, VaultScenarioInput } from '$lib/services/ai/sdk/schemas/vault'
  import type { VaultLorebook, VaultLorebookEntry } from '$lib/types'
  import { Button } from '$lib/components/ui/button'
  import { X, Check, Save, User, BookOpen, Map as MapIcon } from 'lucide-svelte'
  import VaultCharacterFormFields from './VaultCharacterFormFields.svelte'
  import VaultScenarioFormFields from './VaultScenarioFormFields.svelte'
  import VaultLorebookEditorContent from './VaultLorebookEditorContent.svelte'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import { scenarioVault } from '$lib/stores/scenarioVault.svelte'
  import { vaultEditor } from '$lib/stores/vaultEditorStore.svelte'
  import { SvelteMap } from 'svelte/reactivity'

  interface Props {
    change: VaultPendingChange
    onApprove: (change?: VaultPendingChange) => void
    onReject?: (change: VaultPendingChange) => void
    onClose: () => void
  }

  let { change, onApprove, onReject, onClose }: Props = $props()

  // Local state for the editable data (character / scenario)
  let charData = $state<VaultCharacterInput | null>(null)
  let entryData = $state<VaultLorebookEntry | null>(null)
  let scenarioData = $state<VaultScenarioInput | null>(null)

  // Initialize local state from the change data
  $effect(() => {
    if (change.entityType === 'character' && 'data' in change) {
      charData = JSON.parse(JSON.stringify(change.data))
    } else if (change.entityType === 'lorebook-entry' && 'data' in change) {
      entryData = JSON.parse(JSON.stringify(change.data))
    } else if (change.entityType === 'scenario' && 'data' in change) {
      scenarioData = JSON.parse(JSON.stringify(change.data))
    }
  })

  /** Inject a portrait data URL into the local form state (called externally) */
  export function setPortrait(dataUrl: string) {
    if (charData) {
      charData = { ...charData, portrait: dataUrl }
      emitUpdate()
    }
  }

  /** Push local edits to the store so "Approve" uses the edited version */
  function emitUpdate() {
    if (change.entityType === 'character' && charData) {
      vaultEditor.updateChangeData(change.id, {
        ...change,
        data: charData,
      } as VaultPendingChange)
    } else if (change.entityType === 'lorebook-entry' && entryData) {
      vaultEditor.updateChangeData(change.id, {
        ...change,
        data: entryData,
      } as VaultPendingChange)
    } else if (change.entityType === 'scenario' && scenarioData) {
      vaultEditor.updateChangeData(change.id, {
        ...change,
        data: scenarioData,
      } as VaultPendingChange)
    }
  }

  function handleApproveWithEdits() {
    emitUpdate()
    onApprove()
  }

  /** Save lorebook edits directly to the vault store */
  function handleLorebookEditorSave(updatedLorebook: VaultLorebook) {
    const id = vaultEditor.currentLorebookId
    if (id) {
      lorebookVault.update(id, {
        entries: updatedLorebook.entries,
        name: updatedLorebook.name,
        description: updatedLorebook.description,
        tags: updatedLorebook.tags,
      })
    }
  }

  /** Approve a specific pending entry from the lorebook editor list */
  function handlePendingEntryApprove(pendingChange: VaultPendingChange) {
    onApprove(pendingChange)
  }

  /** Reject a specific pending entry from the lorebook editor list */
  function handlePendingEntryReject(pendingChange: VaultPendingChange) {
    onReject?.(pendingChange)
  }

  const entityLabel = $derived(
    change.entityType === 'character'
      ? 'Character'
      : change.entityType === 'lorebook-entry'
        ? 'Lorebook Entry'
        : change.entityType === 'lorebook'
          ? 'Lorebook'
          : 'Scenario',
  )

  const isViewMode = $derived(vaultEditor.viewMode)

  const actionLabel = $derived(
    isViewMode
      ? 'View'
      : 'action' in change
        ? change.action.charAt(0).toUpperCase() + change.action.slice(1)
        : '',
  )

  /** Save edits directly to the vault store (view mode only) */
  async function handleViewModeSave() {
    const entityId = vaultEditor.viewEntityId
    const entityType = vaultEditor.viewEntityType
    if (!entityId || !entityType) return

    if (entityType === 'character' && charData) {
      await characterVault.update(entityId, {
        name: charData.name,
        description: charData.description,
        traits: charData.traits,
        visualDescriptors: charData.visualDescriptors,
        portrait: charData.portrait,
        tags: charData.tags,
        favorite: charData.favorite,
      })
    } else if (entityType === 'scenario' && scenarioData) {
      await scenarioVault.update(entityId, {
        name: scenarioData.name,
        description: scenarioData.description,
        settingSeed: scenarioData.settingSeed,
        npcs: scenarioData.npcs,
        primaryCharacterName: scenarioData.primaryCharacterName,
        firstMessage: scenarioData.firstMessage,
        alternateGreetings: scenarioData.alternateGreetings,
        tags: scenarioData.tags,
        favorite: scenarioData.favorite,
      })
    }

    onClose()
  }

  // --- Diff computation for update actions ---

  function stringify(val: unknown): string {
    if (val == null) return ''
    if (Array.isArray(val))
      return val.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  function computeChangedFields(
    data: Record<string, unknown> | undefined,
    previous: Record<string, unknown> | undefined,
  ): SvelteMap<string, { old: string; new: string }> {
    const result = new SvelteMap<string, { old: string; new: string }>()
    if (!data || !previous) return result
    for (const key of Object.keys(data)) {
      if (key === 'portrait') continue // skip binary data
      const oldVal = stringify(previous[key])
      const newVal = stringify(data[key])
      if (oldVal !== newVal) {
        result.set(key, { old: oldVal, new: newVal })
      }
    }
    return result
  }

  const changedFieldsMap = $derived.by(() => {
    if (change.action !== 'update' || !('data' in change) || !('previous' in change)) {
      return new SvelteMap<string, { old: string; new: string }>()
    }
    return computeChangedFields(
      change.data as Record<string, unknown>,
      change.previous as Record<string, unknown>,
    )
  })

  const changedFieldKeys = $derived(new Set<string>(changedFieldsMap.keys()))
</script>

<div class="flex h-full flex-col overflow-hidden">
  {#if (change.entityType === 'lorebook-entry' || change.entityType === 'lorebook') && vaultEditor.previewLorebook}
    <!-- Full Lorebook Editor UI — reads derived state from vaultEditor store -->
    {#key change.id}
      <VaultLorebookEditorContent
        lorebook={vaultEditor.previewLorebook}
        initialEntryIndex={vaultEditor.initialEntryIndex}
        onSave={(updated) => handleLorebookEditorSave(updated)}
        {onClose}
        isEmbedded={true}
        isPendingApproval={change.entityType === 'lorebook' && change.status === 'pending'}
        onApprove={handleApproveWithEdits}
        pendingEntries={vaultEditor.pendingEntries}
        onApproveEntry={handlePendingEntryApprove}
        onRejectEntry={handlePendingEntryReject}
        onUpdatePendingChange={(changeToUpdate, newData) => {
          vaultEditor.updateChangeData(changeToUpdate.id, {
            ...changeToUpdate,
            data: newData,
          } as VaultPendingChange)
        }}
      />
    {/key}
  {:else}
    <!-- Standard UI for character / scenario -->
    <!-- Header -->
    <div
      class="border-surface-700 bg-surface-900 flex shrink-0 items-center justify-between border-b px-4 py-2.5"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="flex h-6 w-6 items-center justify-center rounded-md {change.entityType ===
          'character'
            ? 'bg-amber-500/15'
            : change.entityType === 'lorebook-entry'
              ? 'bg-cyan-500/15'
              : 'bg-violet-500/15'}"
        >
          {#if change.entityType === 'character'}
            <User class="h-3 w-3 text-amber-400" />
          {:else if change.entityType === 'lorebook-entry'}
            <BookOpen class="h-3 w-3 text-cyan-400" />
          {:else}
            <MapIcon class="h-3 w-3 text-violet-400" />
          {/if}
        </div>
        <span class="text-surface-200 text-xs font-semibold">{actionLabel} {entityLabel}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="text-surface-400 hover:text-foreground h-6 w-6"
        onclick={onClose}
      >
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- Form -->
    <div class="flex-1 space-y-4 overflow-y-auto">
      {#if change.entityType === 'character' && charData}
        <div class="px-4">
          <VaultCharacterFormFields
            data={charData}
            changedFields={changedFieldKeys}
            onUpdate={(newData) => {
              charData = newData
              emitUpdate()
            }}
          />
        </div>
      {:else if change.entityType === 'scenario' && scenarioData}
        <VaultScenarioFormFields
          data={scenarioData}
          changedFields={changedFieldKeys}
          onUpdate={(newData) => {
            scenarioData = newData
            emitUpdate()
          }}
        />
      {:else if !('data' in change)}
        <div class="p-4">
          <p class="text-muted-foreground text-sm">
            Delete operations cannot be edited — approve or reject directly.
          </p>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div
      class="border-surface-700 bg-surface-900 flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5"
    >
      {#if isViewMode}
        <Button variant="outline" size="sm" class="border-surface-600 h-7 text-xs" onclick={onClose}
          >Close</Button
        >
        <Button
          size="sm"
          class="h-7 gap-1.5 bg-blue-600 text-xs text-white hover:bg-blue-500"
          onclick={handleViewModeSave}
        >
          <Save class="h-3 w-3" />
          Save
        </Button>
      {:else}
        <Button variant="outline" size="sm" class="border-surface-600 h-7 text-xs" onclick={onClose}
          >Cancel</Button
        >
        <Button
          size="sm"
          class="h-7 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
          onclick={handleApproveWithEdits}
        >
          <Check class="h-3 w-3" />
          Confirm & Approve
        </Button>
      {/if}
    </div>
  {/if}
</div>
