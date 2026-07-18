/**
 * Centralized store for the Vault Entity Editor.
 *
 * Single source of truth for:
 *  - Pending changes (from AI tool calls)
 *  - Active editor state (which entity is being edited)
 *  - Preview lorebook (derived from vault store + active change)
 *  - Approval / rejection / edit workflows
 */

import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas'
import type { VaultLorebook, VaultLorebookEntry } from '$lib/types'
import type { InteractiveVaultService } from '$lib/services/ai/vault/InteractiveVaultService'
import { lorebookVault } from './lorebookVault.svelte'
import { characterVault } from './characterVault.svelte'
import { scenarioVault } from './scenarioVault.svelte'
import { SvelteMap } from 'svelte/reactivity'
import { composePendingOnto, scenarioToRecord, characterToRecord } from '$lib/utils/vaultMerge'

class VaultEditorStore {
  // ── Core state ────────────────────────────────────────────────────────

  /** All pending changes across the conversation */
  pendingChanges = $state<VaultPendingChange[]>([])

  /** The change currently open in the entity editor */
  activeChange = $state<VaultPendingChange | null>(null)

  /** Whether the entity editor panel is visible */
  editorOpen = $state(false)

  /** Whether the lorebook editor has unsaved local changes */
  editorDirty = $state(false)

  /** Whether the editor is in view mode (direct editing, no approval workflow) */
  viewMode = $state(false)

  /** Entity ID being viewed (for saving edits in view mode) */
  viewEntityId = $state<string | null>(null)

  /** Entity type being viewed (for routing saves in view mode) */
  viewEntityType = $state<string | null>(null)

  /** Edited versions of pending changes (user modifications before approval) */
  private _editedChanges = $state<SvelteMap<string, VaultPendingChange>>(new SvelteMap())

  // ── Derived values ────────────────────────────────────────────────────

  /** Number of pending (not yet approved/rejected) changes */
  get pendingCount(): number {
    return this.pendingChanges.filter((c) => c.status === 'pending').length
  }

  /**
   * Composed preview for the active entity. Starts from the current vault
   * state (which includes already-approved changes) and overlays remaining
   * pending updates so the editor always reflects reality. Returns null for
   * lorebook-related entities (they use previewLorebook) or when there's no
   * active change.
   */
  get composedData(): Record<string, unknown> | null {
    const change = this.activeChange
    if (!change) return null
    if (change.entityType === 'lorebook' || change.entityType === 'lorebook-entry') return null
    if (change.action !== 'update') return null
    if (!('previous' in change) || !change.previous) return null

    const entityId =
      change.entityType === 'scenario' || change.entityType === 'character' ? change.entityId : null
    if (!entityId) return null

    const pending = this._pendingChangesWithEditOverlay(change.entityType, entityId)

    const base = this._getVaultBase(change.entityType, entityId, change.previous)
    return composePendingOnto(base, pending)
  }

  /**
   * Build a base record from the current vault state for the given entity
   * type and ID. Falls back to `previous` when the entity isn't found
   * (e.g. create actions where the entity doesn't exist in the vault yet).
   */
  private _getVaultBase(
    entityType: string,
    entityId: string,
    previous: Record<string, unknown>,
  ): Record<string, unknown> {
    if (entityType === 'scenario') {
      const live = scenarioVault.getById(entityId)
      if (live) return scenarioToRecord(live)
    } else if (entityType === 'character') {
      const live = characterVault.getById(entityId)
      if (live) return characterToRecord(live)
    }
    return JSON.parse(JSON.stringify(previous))
  }

  /**
   * Collect pending changes for an entity, applying any user edits
   * on top of the original change data/previous.
   */
  private _pendingChangesWithEditOverlay(
    entityType: string,
    entityId: string,
  ): Array<{ data: Record<string, unknown>; previous: Record<string, unknown> }> {
    return this.pendingChanges
      .filter(
        (c) =>
          c.status === 'pending' &&
          c.entityType === entityType &&
          'entityId' in c &&
          c.entityId === entityId &&
          'data' in c &&
          'previous' in c,
      )
      .map((c) => {
        const effective = this._editedChanges.get(c.id) ?? c
        return {
          data: (effective as { data: Record<string, unknown> }).data,
          previous: (effective as { previous: Record<string, unknown> }).previous,
        }
      })
      .filter((c) => c.data && c.previous)
  }

  /**
   * Compose pending changes for an entity onto a base state.
   * Unlike `composedData` (which requires `activeChange`), this works
   * from any base state and entity ID — used by view mode to overlay
   * unapproved changes onto the current vault entity.
   */
  composePendingChanges(
    base: Record<string, unknown>,
    entityType: 'character' | 'scenario',
    entityId: string,
  ): Record<string, unknown> {
    const pending = this._pendingChangesWithEditOverlay(entityType, entityId)
    if (pending.length === 0) return base
    return composePendingOnto(base, pending)
  }

  /** Human-readable breakdown of pending changes by type */
  get pendingBreakdown(): string {
    const pending = this.pendingChanges.filter((c) => c.status === 'pending')
    const counts: Record<string, number> = {}
    for (const c of pending) {
      switch (c.entityType) {
        case 'character':
          counts['character'] = (counts['character'] ?? 0) + 1
          break
        case 'lorebook-entry':
          counts['entry'] = (counts['entry'] ?? 0) + 1
          break
        case 'scenario':
          counts['scenario'] = (counts['scenario'] ?? 0) + 1
          break
        case 'lorebook':
          counts['lorebook'] = (counts['lorebook'] ?? 0) + 1
          break
      }
    }
    return Object.entries(counts)
      .map(([type, count]) => {
        const noun = count > 1 ? (type === 'entry' ? 'entries' : `${type}s`) : type
        return `${count} ${noun}`
      })
      .join(', ')
  }

  /** Lorebook ID associated with the active change (if any) */
  get currentLorebookId(): string | null {
    const change = this.activeChange
    if (!change) return null
    if (change.entityType === 'lorebook') return change.entityId
    if (change.entityType === 'lorebook-entry') return change.lorebookId
    return null
  }

  /** Pending lorebook-entry changes for the currently-open lorebook */
  get pendingEntries(): Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>[] {
    const lorebookId = this.currentLorebookId
    if (!lorebookId) return []
    return this.pendingChanges
      .filter(
        (c): c is Extract<VaultPendingChange, { entityType: 'lorebook-entry' }> =>
          c.entityType === 'lorebook-entry' &&
          c.lorebookId === lorebookId &&
          c.status === 'pending',
      )
      .map((c) => (this._editedChanges.get(c.id) as typeof c) ?? c)
  }

  /** Preview lorebook for the active change — reads live from vault store */
  get previewLorebook(): VaultLorebook | null {
    let change = this.activeChange
    if (!change) return null

    // Use edited version if available
    change = this._editedChanges.get(change.id) ?? change

    if (change.entityType === 'lorebook-entry') {
      const lorebook = lorebookVault.getById(change.lorebookId)
      if (!lorebook) return null
      const copy = JSON.parse(JSON.stringify(lorebook)) as VaultLorebook

      // Overlay ALL pending changes for this lorebook onto the preview copy
      // Process deletes/merges in descending index order to avoid shifting
      const entryChanges = this.pendingChanges
        .filter(
          (c): c is Extract<VaultPendingChange, { entityType: 'lorebook-entry' }> =>
            c.entityType === 'lorebook-entry' &&
            c.status === 'pending' &&
            (c as Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>).lorebookId ===
              change.lorebookId,
        )
        .map(
          (c) =>
            (this._editedChanges.get(c.id) ?? c) as Extract<
              VaultPendingChange,
              { entityType: 'lorebook-entry' }
            >,
        )

      const deletesAndMerges = entryChanges.filter(
        (
          c,
        ): c is Extract<
          VaultPendingChange,
          { entityType: 'lorebook-entry'; action: 'delete' | 'merge' }
        > => c.action === 'delete' || c.action === 'merge',
      )
      const creates = entryChanges.filter(
        (c): c is Extract<VaultPendingChange, { entityType: 'lorebook-entry'; action: 'create' }> =>
          c.action === 'create',
      )
      const updates = entryChanges.filter(
        (c): c is Extract<VaultPendingChange, { entityType: 'lorebook-entry'; action: 'update' }> =>
          c.action === 'update',
      )

      // Apply updates before deletes/merges so index references are stable
      // (updates don't add/remove entries, so they don't shift positions)
      for (const entryChange of updates) {
        if (
          typeof entryChange.entryIndex === 'number' &&
          entryChange.entryIndex >= 0 &&
          entryChange.entryIndex < copy.entries.length
        ) {
          const safeData = Object.fromEntries(
            Object.entries(entryChange.data ?? {}).filter(([_, v]) => v !== ''),
          ) as Partial<VaultLorebookEntry>
          copy.entries[entryChange.entryIndex] = {
            ...copy.entries[entryChange.entryIndex],
            ...safeData,
          }
        }
      }

      deletesAndMerges.sort((a, b) => {
        const aIdx = a.action === 'delete' ? a.entryIndex : Math.max(...a.entryIndices)
        const bIdx = b.action === 'delete' ? b.entryIndex : Math.max(...b.entryIndices)
        return bIdx - aIdx
      })

      for (const entryChange of deletesAndMerges) {
        switch (entryChange.action) {
          case 'delete':
            if (
              typeof entryChange.entryIndex === 'number' &&
              entryChange.entryIndex >= 0 &&
              entryChange.entryIndex < copy.entries.length
            ) {
              copy.entries.splice(entryChange.entryIndex, 1)
            }
            break
          case 'merge':
            if (entryChange.entryIndices) {
              const sorted = [...entryChange.entryIndices].sort((a, b) => b - a)
              for (const idx of sorted) {
                if (idx >= 0 && idx < copy.entries.length) {
                  copy.entries.splice(idx, 1)
                }
              }
              copy.entries.push(entryChange.data)
            }
            break
        }
      }

      for (const entryChange of creates) {
        if (!copy.entries.some((e) => e.name === entryChange.data.name)) {
          copy.entries.push(entryChange.data)
        }
      }

      return copy
    }

    if (change.entityType === 'lorebook' && 'data' in change) {
      // Try vault first (the lorebook may already be approved & saved)
      const existing = lorebookVault.getById(change.entityId)
      if (existing) {
        return JSON.parse(JSON.stringify(existing)) as VaultLorebook
      }
      // Not yet approved — construct a preview from the change data
      return {
        id: change.entityId,
        name: change.data.name,
        description: change.data.description,
        tags: change.data.tags,
        entries: [],
        metadata: {
          format: 'aventura',
          totalEntries: 0,
          entryBreakdown: {
            character: 0,
            location: 0,
            item: 0,
            faction: 0,
            concept: 0,
            event: 0,
          } as Record<string, number>,
        },
        favorite: false,
        source: 'manual',
        originalFilename: null,
        originalStoryId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as VaultLorebook
    }

    return null
  }

  /** Initial entry index for the lorebook editor (for scroll-to-entry) */
  get initialEntryIndex(): number | null {
    const change = this.activeChange
    if (!change) return null
    if (change.entityType !== 'lorebook-entry') return null

    if ((change.action === 'create' || change.action === 'merge') && 'data' in change) {
      const pendingIdx = this.pendingEntries.findIndex((c) => c.id === change.id)
      return pendingIdx >= 0 ? -100 - pendingIdx : null
    }
    if (change.action === 'update' && typeof change.entryIndex === 'number') {
      return change.entryIndex
    }
    return null
  }

  // ── Mutation methods ──────────────────────────────────────────────────

  /**
   * Add a pending change (with deduplication by ID).
   * Does NOT auto-open the editor — call openEditorForChange() separately.
   */
  addPendingChange(change: VaultPendingChange): void {
    if (!this.pendingChanges.some((c) => c.id === change.id)) {
      this.pendingChanges = [...this.pendingChanges, change]
    }
  }

  /**
   * Smart editor open: opens for the given change, but skips if the editor
   * is already showing the same lorebook (to avoid resetting state).
   * Exits view mode so the approval workflow is active for the new change.
   */
  openEditorSmart(change: VaultPendingChange): void {
    if (this.isShowingSameLorebook(change)) return
    this.viewMode = false
    this.viewEntityId = null
    this.viewEntityType = null
    this.activeChange = change
    this.editorOpen = true
  }

  /** Force-open the editor for a specific change */
  openEditor(change: VaultPendingChange): void {
    this.viewMode = false
    this.viewEntityId = null
    this.viewEntityType = null
    this.activeChange = change
    this.editorOpen = true
  }

  /** Open the editor in view mode for direct editing (no approval workflow) */
  openViewer(change: VaultPendingChange, entityId: string, entityType: string): void {
    this.activeChange = change
    this.editorOpen = true
    this.viewMode = true
    this.viewEntityId = entityId
    this.viewEntityType = entityType
  }

  /** Close the editor panel */
  closeEditor(): void {
    this.activeChange = null
    this.editorOpen = false
    this.viewMode = false
    this.viewEntityId = null
    this.viewEntityType = null
  }

  /**
   * Record a user edit to a pending change (for "edit before approve" flow).
   * Stores the modified change so approval uses the edited version.
   */
  updateChangeData(changeId: string, updatedChange: VaultPendingChange): void {
    this._editedChanges = new SvelteMap(this._editedChanges).set(changeId, updatedChange)
  }

  /** Return the edited version of a change if one exists, otherwise the original. */
  getEffectiveChange(change: VaultPendingChange): VaultPendingChange {
    return this._editedChanges.get(change.id) ?? change
  }

  /**
   * Approve a single pending change.
   * Uses the edited version if the user modified it before approving.
   * Re-indexes remaining pending lorebook-entry changes if this approval
   * shifts array indices (delete / merge).
   */
  async approve(change: VaultPendingChange, service: InteractiveVaultService): Promise<void> {
    if (change.status !== 'pending') return

    const effectiveChange = this._editedChanges.get(change.id) ?? change
    await service.applyChange(effectiveChange)
    service.handleApproval(change, true)

    // Clean up edited version
    const edits = new SvelteMap(this._editedChanges)
    edits.delete(change.id)
    this._editedChanges = edits

    // Mark as approved
    for (const c of this.pendingChanges) {
      if (c.id === change.id) c.status = 'approved'
    }

    // Re-index remaining pending changes whose indices may have shifted
    this._reindexAfterApproval(effectiveChange)

    // Auto-close logic: keep open for lorebook-related, close for others
    this._autoCloseAfterAction(change)

    // Trigger reactivity
    this.pendingChanges = [...this.pendingChanges]
  }

  /** Reject a single pending change */
  reject(change: VaultPendingChange, service: InteractiveVaultService): void {
    if (change.status !== 'pending') return
    service.handleApproval(change, false)

    const edits = new SvelteMap(this._editedChanges)
    edits.delete(change.id)
    this._editedChanges = edits

    for (const c of this.pendingChanges) {
      if (c.id === change.id) c.status = 'rejected'
    }

    this._autoCloseAfterAction(change)
    this.pendingChanges = [...this.pendingChanges]
  }

  /** Approve all pending changes — processes deletes/merges in descending index order to avoid shifting */
  async approveAll(service: InteractiveVaultService): Promise<string | null> {
    const pending = this.pendingChanges.filter((c) => c.status === 'pending')

    // Separate by type and action
    const lorebookEntryChanges = pending.filter(
      (c): c is Extract<VaultPendingChange, { entityType: 'lorebook-entry' }> =>
        c.entityType === 'lorebook-entry',
    )
    const otherChanges = pending.filter((c) => c.entityType !== 'lorebook-entry')

    // For lorebook-entry changes: group by lorebook, then process deletes/merges in descending order
    const byLorebook = new SvelteMap<
      string,
      Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>[]
    >()
    for (const change of lorebookEntryChanges) {
      const group = byLorebook.get(change.lorebookId) ?? []
      group.push(change)
      byLorebook.set(change.lorebookId, group)
    }

    // Process each lorebook's changes: deletes/merges descending, then creates/updates ascending
    for (const [_lorebookId, changes] of byLorebook) {
      const deletesAndMerges = changes.filter((c) => c.action === 'delete' || c.action === 'merge')
      const createsAndUpdates = changes.filter(
        (c) => c.action === 'create' || c.action === 'update',
      )

      // Sort deletes/merges by descending entryIndex (or highest entryIndex for merges)
      deletesAndMerges.sort((a, b) => {
        const aIdx = a.action === 'delete' ? a.entryIndex : Math.max(...a.entryIndices)
        const bIdx = b.action === 'delete' ? b.entryIndex : Math.max(...b.entryIndices)
        return bIdx - aIdx
      })

      // Process deletes/merges first (descending order)
      for (const change of deletesAndMerges) {
        try {
          const effectiveChange = this._editedChanges.get(change.id) ?? change
          await service.applyChange(effectiveChange)
          service.handleApproval(change, true)

          const edits = new SvelteMap(this._editedChanges)
          edits.delete(change.id)
          this._editedChanges = edits

          for (const c of this.pendingChanges) {
            if (c.id === change.id) c.status = 'approved'
          }

          // Re-index remaining pending changes after each delete/merge
          this._reindexAfterApproval(effectiveChange)
        } catch (e) {
          return e instanceof Error ? e.message : 'Failed to apply change'
        }
      }

      // Process creates/updates (order doesn't matter for index shifting)
      for (const change of createsAndUpdates) {
        try {
          const effectiveChange = this._editedChanges.get(change.id) ?? change
          await service.applyChange(effectiveChange)
          service.handleApproval(change, true)

          const edits = new SvelteMap(this._editedChanges)
          edits.delete(change.id)
          this._editedChanges = edits

          for (const c of this.pendingChanges) {
            if (c.id === change.id) c.status = 'approved'
          }
        } catch (e) {
          return e instanceof Error ? e.message : 'Failed to apply change'
        }
      }
    }

    // Process non-lorebook-entry changes (characters, scenarios, lorebooks)
    for (const change of otherChanges) {
      try {
        const effectiveChange = this._editedChanges.get(change.id) ?? change
        await service.applyChange(effectiveChange)
        service.handleApproval(change, true)

        const edits = new SvelteMap(this._editedChanges)
        edits.delete(change.id)
        this._editedChanges = edits

        for (const c of this.pendingChanges) {
          if (c.id === change.id) c.status = 'approved'
        }
      } catch (e) {
        return e instanceof Error ? e.message : 'Failed to apply change'
      }
    }

    // Auto-close unless active editor is lorebook-related
    if (this.activeChange) {
      this._autoCloseAfterAction(this.activeChange)
    }

    this.pendingChanges = [...this.pendingChanges]
    return null // success
  }

  /** Get the live version of a change (includes pending status updates) */
  getLiveChange(changeId: string): VaultPendingChange | undefined {
    return this.pendingChanges.find((c) => c.id === changeId)
  }

  /** Reset all editor state (for new conversations) */
  reset(): void {
    this.pendingChanges = []
    this.activeChange = null
    this.editorOpen = false
    this.editorDirty = false
    this.viewMode = false
    this.viewEntityId = null
    this.viewEntityType = null
    this._editedChanges = new SvelteMap()
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /** Check if the editor is already showing a lorebook matching the incoming change */
  private isShowingSameLorebook(incoming: VaultPendingChange): boolean {
    if (!this.editorOpen || !this.activeChange) return false

    const activeType = this.activeChange.entityType
    if (activeType !== 'lorebook' && activeType !== 'lorebook-entry') return false

    const activeLorebookId = this.currentLorebookId
    const incomingLorebookId =
      incoming.entityType === 'lorebook-entry'
        ? incoming.lorebookId
        : incoming.entityType === 'lorebook'
          ? incoming.entityId
          : null

    return incomingLorebookId != null && activeLorebookId === incomingLorebookId
  }

  /** After approval/rejection, keep the editor open for continued iteration.
   * For characters and scenarios, transition to view mode so the user can
   * review the updated entity and make direct edits or request more changes.
   * For lorebook deletes, close entirely (the entity is gone).
   *
   * If the editor is currently showing a different change for the same entity
   * type & ID, still transition to view mode so the user sees the updated
   * entity including the just-approved change. If it's a different entity
   * entirely, skip the transition so we don't yank the user to a different
   * entity.
   */
  private _autoCloseAfterAction(change: VaultPendingChange): void {
    const isLorebook = change.entityType === 'lorebook'
    const isLorebookEntry = change.entityType === 'lorebook-entry'
    const isDelete = change.action === 'delete'

    // Lorebook deletes close the editor entirely (the entity is gone)
    if (isLorebook && isDelete) {
      this.closeEditor()
      return
    }

    // Lorebook entries and lorebook creates/updates keep existing behavior
    // (the lorebook editor handles multi-entry iteration natively)
    if (isLorebookEntry || (isLorebook && !isDelete)) return

    // Characters and scenarios: transition to view mode so the user can
    // review the result and make direct edits or continue iterating.
    const entityId = 'entityId' in change ? (change.entityId as string) : null
    if (!entityId) {
      this.closeEditor()
      return
    }

    const entityType = change.entityType === 'character' ? 'character' : 'scenario'

    // If the editor is open and showing either the same change or another
    // change for the same entity, transition to view mode for that entity.
    // If the editor is showing a completely different entity, skip the
    // transition — we don't want to yank the user away from their work.
    if (this.editorOpen && this.activeChange) {
      const activeEntityId =
        'entityId' in this.activeChange ? (this.activeChange.entityId as string) : null
      const activeEntityType = this.activeChange.entityType

      if (activeEntityId === entityId && activeEntityType === change.entityType) {
        // Same entity — transition to view mode so the approved change
        // is visible in the composed data
        this.viewMode = true
        this.viewEntityId = entityId
        this.viewEntityType = entityType
      }
      // Different entity — leave editor as-is; the composed data getter
      // now reads from the vault so it will reflect the approved change
    }
  }

  /**
   * Re-index remaining pending lorebook-entry changes after an approval
   * that modified the entries array (delete or merge).
   * Mutates in-place so all refs (including snapshots in approveAll) stay current.
   */
  private _reindexAfterApproval(approvedChange: VaultPendingChange): void {
    // Only lorebook-entry changes need re-indexing
    if (approvedChange.entityType !== 'lorebook-entry') return
    if (approvedChange.action !== 'delete' && approvedChange.action !== 'merge') return

    const lorebookId =
      approvedChange.entityType === 'lorebook-entry' ? approvedChange.lorebookId : null
    if (!lorebookId) return

    // Update pendingChanges in-place (entries are $state proxy objects)
    for (let i = 0; i < this.pendingChanges.length; i++) {
      const c = this.pendingChanges[i]
      if (
        c.entityType !== 'lorebook-entry' ||
        c.status !== 'pending' ||
        c.id === approvedChange.id
      ) {
        continue
      }
      const entryChange = c as Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>
      if (entryChange.lorebookId !== lorebookId) continue

      const result = this._shiftIndexForApproval(approvedChange, entryChange)
      if (result !== null) {
        if (entryChange.action === 'delete' || entryChange.action === 'update') {
          entryChange.entryIndex = result
        }
        // For merge, entryIndices was already mutated in-place by _shiftIndexForApproval
      }
    }

    // Also update _editedChanges — SvelteMap values are proxied, mutate in-place
    for (const id of [...this._editedChanges.keys()]) {
      const edited = this._editedChanges.get(id)
      if (
        !edited ||
        edited.entityType !== 'lorebook-entry' ||
        edited.id === approvedChange.id ||
        (edited as Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>).lorebookId !==
          lorebookId
      ) {
        continue
      }
      const entryEdited = edited as Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>
      const result = this._shiftIndexForApproval(approvedChange, entryEdited)
      if (result !== null) {
        if (entryEdited.action === 'delete' || entryEdited.action === 'update') {
          entryEdited.entryIndex = result
        }
        // For merge, entryIndices was already mutated in-place by _shiftIndexForApproval
      }
    }
  }

  /**
   * Compute the new index for a pending change after an approval.
   * Returns null if no change needed.
   */
  private _shiftIndexForApproval(
    approved: VaultPendingChange,
    pending: Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>,
  ): number | null {
    if (approved.entityType !== 'lorebook-entry') return null

    if (approved.action === 'delete') {
      const deletedIndex = approved.entryIndex
      if (pending.action === 'delete' || pending.action === 'update') {
        const pendingIndex = pending.entryIndex
        if (pendingIndex > deletedIndex) {
          return pendingIndex - 1
        }
      } else if (pending.action === 'merge') {
        // Merge has entryIndices array - shift each one
        const newIndices = pending.entryIndices.map((idx) => (idx > deletedIndex ? idx - 1 : idx))
        // Check if array changed
        if (newIndices.some((idx, i) => idx !== pending.entryIndices[i])) {
          ;(
            pending as Extract<
              VaultPendingChange,
              { entityType: 'lorebook-entry'; action: 'merge' }
            >
          ).entryIndices = newIndices
          // Return 0 to signal a change happened (the caller will use the mutated entryIndices)
          return 0
        }
      }
    } else if (approved.action === 'merge') {
      // Merge removes source entries (in descending order) then appends the result
      const removedIndices = [...approved.entryIndices].sort((a, b) => b - a) // descending
      let totalShift = 0
      let mergeChanged = false
      for (const removedIdx of removedIndices) {
        if (pending.action === 'delete' || pending.action === 'update') {
          if (pending.entryIndex > removedIdx) {
            totalShift++
          }
        } else if (pending.action === 'merge') {
          // Shift indices in the merge's entryIndices array
          const newIndices = pending.entryIndices.map((idx) => (idx > removedIdx ? idx - 1 : idx))
          ;(
            pending as Extract<
              VaultPendingChange,
              { entityType: 'lorebook-entry'; action: 'merge' }
            >
          ).entryIndices = newIndices
          mergeChanged = true
        }
      }
      if ((pending.action === 'delete' || pending.action === 'update') && totalShift > 0) {
        return pending.entryIndex - totalShift
      }
      if (pending.action === 'merge' && mergeChanged) {
        return 0
      }
    }
    return null
  }
}

export const vaultEditor = new VaultEditorStore()
