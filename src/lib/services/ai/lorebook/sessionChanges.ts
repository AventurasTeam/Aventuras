/**
 * What an approved lore change does to the lorebook, while the session is still running.
 *
 * The agent addresses entries by **index**, and the array it indexes into grows: a create
 * or a merge appends, so `list_entries` hands back indices past the end of the entry list
 * the session started with. This module owns the mapping from index to "what writing it
 * back means", so a change to an entry created mid-session lands instead of being dropped
 * after the tool has already answered `success: true`.
 *
 * Changes are applied as they are made, not replayed at the end: the array the tools read
 * is the array this mutates, so an entry created on step 2 is visible on step 3.
 *
 * Plain TypeScript with no store or SDK imports, so it is testable on its own.
 */

import type { Entry, VaultLorebookEntry } from '$lib/types'
import type { LorebookEntryPendingChangeSchema } from '../sdk/schemas/lorebook'
import { createDefaultEntryState } from './entryState'

/** A consolidation: the entries that go away, and the single entry that replaces them. */
export interface LoreMergeResult {
  sources: Entry[]
  merged: Entry
}

/** What the session decided, in the form the caller persists it. */
export interface LoreSessionChanges {
  createdEntries: Entry[]
  updatedEntries: Entry[]
  deletedEntries: Entry[]
  merges: LoreMergeResult[]
}

/**
 * One slot per index of the entry array the tools read.
 *
 * `gone` slots are never spliced out: the model holds indices from the prompt and from
 * every listing it has read, and shifting them makes the next update land elsewhere.
 */
type Slot =
  | { kind: 'existing'; entry: Entry; dirty: boolean }
  | { kind: 'created'; entry: Entry }
  | { kind: 'merged'; entry: Entry; sources: Entry[] }
  | { kind: 'gone' }

/**
 * Every source's hidden info, kept on a merge.
 *
 * The agent is not shown the field, so it cannot carry it into the merged entry itself;
 * taking only the primary's silently dropped what the user wrote on the rest.
 */
function mergeHiddenInfo(sources: Entry[]): string | null {
  const parts = [
    ...new Set(sources.map((e) => e.hiddenInfo?.trim()).filter((t): t is string => !!t)),
  ]
  return parts.length > 0 ? parts.join('\n\n') : null
}

export class LoreSessionLedger {
  private slots: Slot[]
  private deleted: Entry[] = []
  private pendingIdCounter = 0

  /** Indices consumed by a delete or a merge. Shared with the tools, which refuse them. */
  readonly removedIndices = new Set<number>()

  /**
   * @param managed - the entries the session started from, in index order
   * @param vaultEntries - the array the tools read; mutated in step with the slots
   * @param storyId - stamped onto entries this session creates
   */
  constructor(
    managed: Entry[],
    private vaultEntries: VaultLorebookEntry[],
    private storyId: string,
  ) {
    this.slots = managed.map((entry) => ({ kind: 'existing', entry, dirty: false }))
  }

  /** Build the Entry a create or a merge lands as. Real ids are assigned by the caller. */
  private entryFromVault(
    source: VaultLorebookEntry,
    base?: Entry,
    hiddenInfo: string | null = base?.hiddenInfo ?? null,
  ): Entry {
    return {
      id: base?.id ?? `pending-${++this.pendingIdCounter}`,
      storyId: this.storyId,
      name: source.name,
      type: source.type,
      description: source.description,
      hiddenInfo,
      aliases: source.aliases ?? base?.aliases ?? [],
      // A merge keeps the primary's tracked state: it is the same subject, and rebuilding
      // it from a default would forget every relationship and visit count.
      state: base && base.type === source.type ? base.state : createDefaultEntryState(source.type),
      adventureState: base?.adventureState ?? null,
      creativeState: base?.creativeState ?? null,
      injection: {
        mode: source.injectionMode,
        keywords: source.keywords,
        priority: source.priority,
      },
      createdBy: 'ai',
      createdAt: base?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      loreManagementBlacklisted: false,
      branchId: base?.branchId ?? null,
    }
  }

  apply(change: LorebookEntryPendingChangeSchema): void {
    switch (change.type) {
      case 'create':
        return this.create(change)
      case 'update':
        return this.update(change)
      case 'delete':
        return this.delete(change)
      case 'merge':
        return this.merge(change)
    }
  }

  private create(change: LorebookEntryPendingChangeSchema): void {
    if (!change.entry) return
    this.slots.push({ kind: 'created', entry: this.entryFromVault(change.entry) })
    this.vaultEntries.push(change.entry)
  }

  private update(change: LorebookEntryPendingChangeSchema): void {
    if (change.index === undefined || !change.updates) return
    const slot = this.slots[change.index]
    const current = this.vaultEntries[change.index]
    if (!slot || slot.kind === 'gone' || !current) return

    const updates = change.updates
    // From the slot's own entry, not from the pristine one: applying every update to the
    // original meant a second update to the same entry silently dropped the first.
    slot.entry = {
      ...slot.entry,
      ...(updates.name && { name: updates.name }),
      ...(updates.description && { description: updates.description }),
      ...(updates.type && { type: updates.type }),
      ...(updates.aliases && { aliases: updates.aliases }),
      injection: {
        ...slot.entry.injection,
        ...(updates.injectionMode && { mode: updates.injectionMode }),
        ...(updates.keywords && { keywords: updates.keywords }),
        ...(updates.priority !== undefined && { priority: updates.priority }),
      },
      updatedAt: Date.now(),
    }
    if (slot.kind === 'existing') slot.dirty = true

    Object.assign(current, {
      name: slot.entry.name,
      type: slot.entry.type,
      description: slot.entry.description,
      aliases: slot.entry.aliases,
      keywords: slot.entry.injection.keywords,
      priority: slot.entry.injection.priority,
    })
  }

  private delete(change: LorebookEntryPendingChangeSchema): void {
    if (change.index === undefined) return
    const slot = this.slots[change.index]
    if (!slot || slot.kind === 'gone') return
    // A created entry has no row yet, so deleting it is simply not creating it. A merge
    // result is undone by dropping it and removing its sources instead.
    if (slot.kind === 'existing') this.deleted.push(slot.entry)
    if (slot.kind === 'merged') this.deleted.push(...slot.sources)
    this.slots[change.index] = { kind: 'gone' }
    this.removedIndices.add(change.index)
  }

  private merge(change: LorebookEntryPendingChangeSchema): void {
    if (!change.entry) return
    const indices = [...new Set(change.indices ?? [])].filter(
      (i) => this.slots[i] && this.slots[i].kind !== 'gone',
    )
    if (indices.length < 2) return

    // The rows this merge consumes. A member created earlier in the session has no row of
    // its own: it is folded in by simply never being created.
    const sources: Entry[] = []
    for (const index of indices) {
      const slot = this.slots[index]
      if (slot.kind === 'existing') sources.push(slot.entry)
      else if (slot.kind === 'merged') sources.push(...slot.sources)
      this.slots[index] = { kind: 'gone' }
      this.removedIndices.add(index)
    }

    // Oldest source as the primary: its tracked state has had the longest to accumulate.
    const primary =
      sources.length > 0
        ? sources.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
        : undefined
    const merged = this.entryFromVault(change.entry, primary, mergeHiddenInfo(sources))

    this.slots.push(
      sources.length > 0
        ? { kind: 'merged', entry: merged, sources }
        : { kind: 'created', entry: merged },
    )
    this.vaultEntries.push(change.entry)
  }

  /**
   * Read the session off the slots.
   *
   * A slot knows what writing it back means, so an entry created and then updated is one
   * create, and one updated and then deleted is one delete rather than a write followed
   * by its own removal.
   */
  result(): LoreSessionChanges {
    return {
      createdEntries: this.slots.flatMap((s) => (s.kind === 'created' ? [s.entry] : [])),
      updatedEntries: this.slots.flatMap((s) =>
        s.kind === 'existing' && s.dirty ? [s.entry] : [],
      ),
      deletedEntries: this.deleted,
      merges: this.slots.flatMap((s) =>
        s.kind === 'merged' ? [{ sources: s.sources, merged: s.entry }] : [],
      ),
    }
  }
}
