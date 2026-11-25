<script lang="ts">
  import type { VaultPendingChange } from '#lib/services/ai/sdk/schemas/vault.ts'
  import type {
    VaultCharacterInput,
    VaultScenarioInput,
  } from '#lib/services/ai/sdk/schemas/vault.ts'
  import type { VaultLorebook, VaultLorebookEntry } from '#lib/types/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { X, Check, Save, User, BookOpen, Map as MapIcon } from '@lucide/svelte'
  import VaultCharacterFormFields from './VaultCharacterFormFields.svelte'
  import VaultScenarioFormFields from './VaultScenarioFormFields.svelte'
  import VaultLorebookEditorContent from './VaultLorebookEditorContent.svelte'
  import { lorebookVault } from '#lib/stores/lorebookVault.svelte.ts'
  import { characterVault } from '#lib/stores/characterVault.svelte.ts'
  import { scenarioVault } from '#lib/stores/scenarioVault.svelte.ts'
  import { vaultEditor } from '#lib/stores/vaultEditorStore.svelte.ts'
  import { characterToRecord, scenarioToRecord, type ViewDraft } from '#lib/utils/vaultMerge.ts'
  import { SvelteMap } from 'svelte/reactivity'
  import { ui } from '#lib/stores/ui.svelte.ts'

  interface Props {
    change: VaultPendingChange
    onApprove: (change?: VaultPendingChange) => void
    onReject?: (change: VaultPendingChange) => void
    onApproveAllAsync?: () => Promise<string | null>
    /** Called after a view-mode Save, with the pending proposals the saved form already held */
    onViewModeSaved?: (changeIds: string[]) => void
    onClose: () => void
    hideHeader?: boolean
  }

  let {
    change,
    onApprove,
    onReject,
    onApproveAllAsync,
    onViewModeSaved,
    onClose,
    hideHeader = false,
  }: Props = $props()

  let charData = $state<VaultCharacterInput | null>(null)
  let scenarioData = $state<VaultScenarioInput | null>(null)
  let entryData = $state<VaultLorebookEntry | null>(null)
  let formDirty = $state(false)

  // The record the view-mode form was last synced from (`data` equals `previous`), and the pending
  // updates folded into it. Plain variables: only handlers read them.
  let viewSynced: ViewDraft | null = null
  let viewPendingIds: string[] = []

  const composedData = $derived(vaultEditor.composedData)
  const isViewMode = $derived(vaultEditor.viewMode)

  // Edits never carry across targets: edit mode has already pushed them (emitUpdate), and
  // openViewer/openEditor drop the view draft.
  const editTarget = $derived(
    isViewMode ? `${vaultEditor.viewEntityType}:${vaultEditor.viewEntityId}` : change.id,
  )
  $effect.pre(() => {
    void editTarget
    formDirty = false
  })

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
      name: composed.name,
      description: composed.description,
      traits: [...composed.traits],
      visualDescriptors: $state.snapshot(composed.visualDescriptors),
      portrait: composed.portrait ?? null,
      tags: [...composed.tags],
      favorite: composed.favorite,
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
      name: composed.name,
      description: composed.description,
      settingSeed: composed.settingSeed,
      npcs: $state.snapshot(composed.npcs),
      primaryCharacterName: composed.primaryCharacterName,
      firstMessage: composed.firstMessage,
      alternateGreetings: [...(composed.alternateGreetings ?? [])],
      tags: [...composed.tags],
      favorite: composed.favorite,
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
      const entityId = vaultEditor.viewEntityId
      if (viewCharData && entityId) {
        charData = { ...viewCharData }
        const synced = $state.snapshot(viewCharData)
        viewSynced = { entityType: 'character', entityId, data: synced, previous: synced }
        viewPendingIds = vaultEditor.pendingChangeIdsFor('character', entityId)
      } else if (viewScenarioData && entityId) {
        scenarioData = { ...viewScenarioData }
        const synced = $state.snapshot(viewScenarioData)
        viewSynced = { entityType: 'scenario', entityId, data: synced, previous: synced }
        viewPendingIds = vaultEditor.pendingChangeIdsFor('scenario', entityId)
      }
    } else if (formDirty) {
      return
    } else if (change.entityType === 'character' && change.action === 'create') {
      charData = $state.snapshot(change.data)
    } else if (change.entityType === 'character' && change.action === 'update') {
      if (composedData?.entityType === 'character') charData = $state.snapshot(composedData.data)
    } else if (change.entityType === 'lorebook-entry' && 'data' in change) {
      entryData = $state.snapshot(change.data) as VaultLorebookEntry
    } else if (change.entityType === 'scenario' && change.action === 'create') {
      scenarioData = $state.snapshot(change.data)
    } else if (change.entityType === 'scenario' && change.action === 'update') {
      if (composedData?.entityType === 'scenario') {
        scenarioData = $state.snapshot(composedData.data)
      }
    }
  })

  // A panel that is torn down late (the fade-out, or a layout switch) must not clear a draft a
  // newer instance published.
  let publishedDraft: ViewDraft | null = null
  $effect(() => () => {
    if (vaultEditor.viewDraft === publishedDraft) vaultEditor.viewDraft = null
  })

  /** Inject a portrait data URL into the local form state (called externally) */
  export function setPortrait(dataUrl: string) {
    if (charData) {
      charData = { ...charData, portrait: dataUrl }
      formDirty = true
      emitUpdate()
      trackViewDraft()
    }
  }

  /** Publish unsaved view-mode edits so the assistant can see them */
  function trackViewDraft() {
    if (!isViewMode) return
    if (viewSynced?.entityType === 'character' && charData) {
      publishedDraft = vaultEditor.viewDraft = { ...viewSynced, data: $state.snapshot(charData) }
    } else if (viewSynced?.entityType === 'scenario' && scenarioData) {
      publishedDraft = vaultEditor.viewDraft = {
        ...viewSynced,
        data: $state.snapshot(scenarioData),
      }
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

    onViewModeSaved?.(viewPendingIds)
    vaultEditor.viewDraft = null
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
    return computeChangedFields(composedData?.data ?? change.data, change.previous)
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
              trackViewDraft()
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
            trackViewDraft()
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
