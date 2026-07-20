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
  import { characterToRecord, scenarioToRecord } from '$lib/utils/vaultMerge'
  import { SvelteMap } from 'svelte/reactivity'
  import { ui } from '$lib/stores/ui.svelte'

  interface Props {
    change: VaultPendingChange
    onApprove: (change?: VaultPendingChange) => void
    onReject?: (change: VaultPendingChange) => void
    onApproveAllAsync?: () => Promise<string | null>
    onClose: () => void
    hideHeader?: boolean
  }

  let {
    change,
    onApprove,
    onReject,
    onApproveAllAsync,
    onClose,
    hideHeader = false,
  }: Props = $props()

  let charData = $state<VaultCharacterInput | null>(null)
  let scenarioData = $state<VaultScenarioInput | null>(null)
  let entryData = $state<VaultLorebookEntry | null>(null)
  let formDirty = $state(false)

  const composedData = $derived(vaultEditor.composedData)

  // In view mode, the source of truth is the vault store + remaining pending
  // changes, composed reactively. In edit mode, the source is the change data
  // (possibly composed with sibling changes). We use $derived so the form
  // always reflects the latest data without relying on $effect timing.

  const viewCharData = $derived.by(() => {
    if (!vaultEditor.viewMode) return null
    const eid = vaultEditor.viewEntityId
    if (vaultEditor.viewEntityType !== 'character' || !eid) return null
    const existing = characterVault.getById(eid)
    if (!existing) return null
    const composed = vaultEditor.composePendingChanges(
      characterToRecord(existing),
      'character',
      eid,
    )
    return {
      name: composed.name as string,
      description: composed.description as string | null,
      traits: [...(composed.traits as string[])],
      visualDescriptors: JSON.parse(JSON.stringify(composed.visualDescriptors)),
      portrait: (composed.portrait as string | null) ?? null,
      tags: [...(composed.tags as string[])],
      favorite: composed.favorite as boolean,
    }
  })

  const viewScenarioData = $derived.by(() => {
    if (!vaultEditor.viewMode) return null
    const eid = vaultEditor.viewEntityId
    if (vaultEditor.viewEntityType !== 'scenario' || !eid) return null
    const existing = scenarioVault.getById(eid)
    if (!existing) return null
    const composed = vaultEditor.composePendingChanges(scenarioToRecord(existing), 'scenario', eid)
    return {
      name: composed.name as string,
      description: composed.description as string | null,
      settingSeed: composed.settingSeed as string,
      npcs: JSON.parse(JSON.stringify(composed.npcs)),
      primaryCharacterName: composed.primaryCharacterName as string,
      firstMessage: composed.firstMessage as string | null,
      alternateGreetings: (composed.alternateGreetings as string[]) ?? [],
      tags: [...(composed.tags as string[])],
      favorite: composed.favorite as boolean,
    }
  })

  // The data passed to the form: in view mode, use the reactive derived
  // value; in edit mode, use local $state (which may diverge from the
  // source as the user edits).
  const displayCharData = $derived(vaultEditor.viewMode ? viewCharData : charData)
  const displayScenarioData = $derived(vaultEditor.viewMode ? viewScenarioData : scenarioData)

  // Initialize local $state from the current source when switching modes
  // or when the underlying data changes. In both view and edit mode, skip
  // syncing if the user is actively editing (formDirty) to avoid overwriting
  // edits when a new AI tool response arrives — without this guard, a sibling
  // pending change arriving mid-edit (e.g. the agent proposing another update
  // to the same character) silently discards whatever the user just changed,
  // including tag/trait removals via the X button.
  $effect(() => {
    if (isViewMode) {
      if (formDirty) return
      // In view mode, local state is not the source of truth but we keep
      // it in sync so that handleViewModeSave can use it after user edits.
      if (viewCharData) {
        charData = { ...viewCharData }
      } else if (viewScenarioData) {
        scenarioData = { ...viewScenarioData }
      }
    } else if (formDirty) {
      return
    } else if (change.entityType === 'character' && 'data' in change && change.data) {
      const source =
        composedData ??
        ('previous' in change && change.previous
          ? {
              ...(change.previous as Record<string, unknown>),
              ...(change.data as Record<string, unknown>),
            }
          : change.data)
      charData = JSON.parse(JSON.stringify(source))
    } else if (change.entityType === 'lorebook-entry' && 'data' in change) {
      entryData = JSON.parse(JSON.stringify(change.data))
    } else if (change.entityType === 'scenario' && 'data' in change && change.data) {
      const source =
        composedData ??
        ('previous' in change && change.previous
          ? {
              ...(change.previous as Record<string, unknown>),
              ...(change.data as Record<string, unknown>),
            }
          : change.data)
      scenarioData = JSON.parse(JSON.stringify(source))
    }
  })

  /** Inject a portrait data URL into the local form state (called externally) */
  export function setPortrait(dataUrl: string) {
    if (charData) {
      charData = { ...charData, portrait: dataUrl }
      formDirty = true
      emitUpdate()
    }
  }

  /** Push local edits to the store so "Approve" uses the edited version.
   * Scopes the saved data to only this change's modifications — fields
   * that differ between the original change.data and change.previous are
   * taken from the current form; everything else stays as change.data.
   * This prevents sibling pending changes from leaking into this change.
   */
  function emitUpdate() {
    if (change.entityType === 'character' && charData) {
      const scoped = scopeToOwnChanges(charData, change)
      vaultEditor.updateChangeData(change.id, {
        ...change,
        data: scoped,
      } as VaultPendingChange)
    } else if (change.entityType === 'lorebook-entry' && entryData) {
      vaultEditor.updateChangeData(change.id, {
        ...change,
        data: entryData,
      } as VaultPendingChange)
    } else if (change.entityType === 'scenario' && scenarioData) {
      const scoped = scopeToOwnChanges(scenarioData, change)
      vaultEditor.updateChangeData(change.id, {
        ...change,
        data: scoped,
      } as VaultPendingChange)
    }
  }

  /**
   * Given the current form data (which may include sibling changes via
   * composedData), produce a version scoped to only this change's
   * modifications.
   *
   * For AI-modified fields: use originalData (the AI's intent for this
   * change only), NOT the composed form value. The composed form includes
   * sibling changes, which would cause duplicate additions/approvals.
   * For scalar AI-modified fields, allow user edits by using form[key] if
   * the user explicitly changed the value from originalData.
   *
   * For fields the user edited that weren't in the original AI change:
   * include those edits from the form data.
   */
  function scopeToOwnChanges(
    formData: VaultCharacterInput | VaultScenarioInput,
    change: VaultPendingChange,
  ): VaultCharacterInput | VaultScenarioInput {
    if (!('previous' in change) || !change.previous || !('data' in change)) return formData
    const previous = change.previous as Record<string, unknown>
    const originalData = change.data as Record<string, unknown>
    const form = formData as Record<string, unknown>
    const result: Record<string, unknown> = { ...previous }

    for (const key of Object.keys(originalData)) {
      if (JSON.stringify(originalData[key]) !== JSON.stringify(previous[key])) {
        // Array fields: always use originalData to prevent sibling changes
        // from leaking into this change's data. Array additions from sibling
        // changes must be approved separately, not carried along.
        if (Array.isArray(originalData[key])) {
          result[key] = originalData[key]
        } else {
          // Scalar fields: use form value ONLY if the user explicitly
          // edited it (form differs from originalData). Otherwise use
          // originalData to preserve this change's intent, preventing
          // sibling scalar values from leaking via composedData.
          result[key] =
            JSON.stringify(form[key]) !== JSON.stringify(originalData[key])
              ? form[key]
              : originalData[key]
        }
      }
    }

    // Fields the user edited that weren't in the original AI change — include
    // those edits from the composed form data.
    for (const key of Object.keys(form)) {
      if (key in result) continue
      if (JSON.stringify(form[key]) !== JSON.stringify(previous[key])) {
        result[key] = form[key]
      }
    }

    return result as VaultCharacterInput | VaultScenarioInput
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

    formDirty = false
    ui.showToast('Changes saved', 'info')
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
    if (isViewMode) return new SvelteMap<string, { old: string; new: string }>()
    if (change.action !== 'update' || !('data' in change) || !('previous' in change)) {
      return new SvelteMap<string, { old: string; new: string }>()
    }
    // When multiple pending updates target the same entity, diff the composed
    // preview against the original so the editor highlights ALL changed fields
    // (not just the fields from this single change).
    const data = (composedData ?? change.data) as Record<string, unknown>
    return computeChangedFields(data, change.previous as Record<string, unknown>)
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
        {onApproveAllAsync}
        {hideHeader}
      />
    {/key}
  {:else}
    <!-- Standard UI for character / scenario -->
    {#if !hideHeader}
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
    {/if}

    <!-- Form -->
    <div class="flex-1 space-y-4 overflow-y-auto">
      {#if change.entityType === 'character' && displayCharData}
        <div class="px-4">
          <VaultCharacterFormFields
            data={displayCharData}
            changedFields={changedFieldKeys}
            onUpdate={(newData) => {
              charData = newData
              formDirty = true
              emitUpdate()
            }}
          />
        </div>
      {:else if change.entityType === 'scenario' && displayScenarioData}
        <VaultScenarioFormFields
          data={displayScenarioData}
          changedFields={changedFieldKeys}
          onUpdate={(newData) => {
            scenarioData = newData
            formDirty = true
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
