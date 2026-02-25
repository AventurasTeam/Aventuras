/**
 * Centralized store for the Vault Entity Editor.
 *
 * Single source of truth for:
 *  - Pending changes (from AI tool calls)
 *  - Active editor state (which entity is being edited)
 *  - Preview lorebook (derived from vault store + active change)
 *  - Approval / rejection / edit workflows
 */

import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas/vault'
import type { VaultLorebook, VaultLorebookEntry } from '$lib/types'
import type { InteractiveVaultService } from '$lib/services/ai/vault/InteractiveVaultService'
import { lorebookVault } from './lorebookVault.svelte'
import { SvelteMap } from 'svelte/reactivity'

class VaultEditorStore {
  // ── Core state ────────────────────────────────────────────────────────

  /** All pending changes across the conversation */
  pendingChanges = $state<VaultPendingChange[]>([])

  /** The change currently open in the entity editor */
  activeChange = $state<VaultPendingChange | null>(null)

  /** Whether the entity editor panel is visible */
  editorOpen = $state(false)

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

      // Overlay update changes onto the preview copy
      if (change.action === 'update' && 'data' in change && typeof change.entryIndex === 'number') {
        if (change.entryIndex >= 0 && change.entryIndex < copy.entries.length) {
          copy.entries[change.entryIndex] = {
            ...copy.entries[change.entryIndex],
            ...(change.data as VaultLorebookEntry),
          }
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
   */
  openEditorSmart(change: VaultPendingChange): void {
    if (this.isShowingSameLorebook(change)) return
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

  /**
   * Approve a single pending change.
   * Uses the edited version if the user modified it before approving.
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

  /** Approve all pending changes */
  async approveAll(service: InteractiveVaultService): Promise<string | null> {
    const pending = this.pendingChanges.filter((c) => c.status === 'pending')
    for (const change of pending) {
      try {
        const effectiveChange = this._editedChanges.get(change.id) ?? change
        await service.applyChange(effectiveChange)
        service.handleApproval(change, true)

        const edits = new SvelteMap(this._editedChanges)
        edits.delete(change.id)
        this._editedChanges = edits
      } catch (e) {
        return e instanceof Error ? e.message : 'Failed to apply change'
      }
    }

    // Mark all as approved
    for (const c of this.pendingChanges) {
      if (pending.some((p) => p.id === c.id)) {
        c.status = 'approved'
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

  /** Auto-close editor after approval/rejection (unless lorebook-related) */
  private _autoCloseAfterAction(change: VaultPendingChange): void {
    if (this.activeChange?.id !== change.id) return

    const isLorebook = change.entityType === 'lorebook'
    const isLorebookEntry = change.entityType === 'lorebook-entry'
    const isDelete = change.action === 'delete'

    if ((!isLorebookEntry && !isLorebook) || (isLorebook && isDelete)) {
      this.closeEditor()
    }
  }
}

export const vaultEditor = new VaultEditorStore()
