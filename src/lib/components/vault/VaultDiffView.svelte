<script lang="ts">
  import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas/vault'
  import type {
    VaultCharacter,
    VaultLorebookEntry,
    VaultScenarioNpc,
    VisualDescriptors,
  } from '$lib/types'
  import {
    Check,
    X,
    ArrowRight,
    Trash2,
    GitMerge,
    Plus,
    Pencil,
    User,
    BookOpen,
    Map,
    CheckCircle2,
    XCircle,
    Zap,
  } from 'lucide-svelte'
  import { fade } from 'svelte/transition'

  interface Props {
    change: VaultPendingChange
    onApprove: () => void
    onReject: () => void
    onEdit?: () => void
  }

  let { change, onApprove, onReject, onEdit }: Props = $props()

  const isApproved = $derived(change.status === 'approved')
  const isRejected = $derived(change.status === 'rejected')
  const isAutoApproved = $derived(
    isApproved && change.entityType === 'lorebook' && change.action === 'create',
  )

  // --- Entity type display config ---

  const entityConfig = $derived.by(() => {
    switch (change.entityType) {
      case 'character':
        return { label: 'Character', icon: User, color: 'text-amber-400', bg: 'bg-amber-500/15' }
      case 'lorebook-entry':
        return {
          label: 'Lorebook entry',
          icon: BookOpen,
          color: 'text-cyan-400',
          bg: 'bg-cyan-500/15',
        }
      case 'scenario':
        return { label: 'Scenario', icon: Map, color: 'text-violet-400', bg: 'bg-violet-500/15' }
      case 'lorebook':
        return { label: 'Lorebook', icon: BookOpen, color: 'text-blue-400', bg: 'bg-blue-500/15' }
      default:
        // Fallback for safety
        return {
          label: 'Entity',
          icon: BookOpen,
          color: 'text-surface-400',
          bg: 'bg-surface-500',
        }
    }
  })

  const actionConfig = $derived.by(() => {
    switch (change.action) {
      case 'create':
        return { label: 'Create', icon: Plus, color: 'text-green-400' }
      case 'update':
        return { label: 'Update', icon: ArrowRight, color: 'text-blue-400' }
      case 'delete':
        return { label: 'Delete', icon: Trash2, color: 'text-red-400' }
      case 'merge':
        return { label: 'Merge', icon: GitMerge, color: 'text-purple-400' }
    }
  })

  // --- Entity name extraction ---

  const entityName = $derived.by(() => {
    if (change.entityType === 'character') {
      if (change.action === 'create') return change.data.name
      if (change.action === 'update') return change.data.name ?? change.previous?.name ?? 'Unknown'
      if (change.action === 'delete') return change.previous?.name ?? 'Unknown'
    }
    if (change.entityType === 'lorebook-entry') {
      if (change.action === 'create') return change.data.name
      if (change.action === 'update') return change.data.name ?? change.previous?.name ?? 'Unknown'
      if (change.action === 'delete') return change.previous?.name ?? 'Unknown'
      if (change.action === 'merge') return change.data.name
    }
    if (change.entityType === 'scenario') {
      if (change.action === 'create') return change.data.name
      if (change.action === 'update') return change.data.name ?? change.previous?.name ?? 'Unknown'
      if (change.action === 'delete') return change.previous?.name ?? 'Unknown'
    }
    if (change.entityType === 'lorebook') {
      if (change.action === 'create') return change.data.name
      if (change.action === 'update') return change.data.name ?? change.previous?.name ?? 'Unknown'
      if (change.action === 'delete') return change.previous?.name ?? 'Unknown'
    }
    return 'Unknown'
  })

  // --- Formatting helpers ---

  function formatVisualDescriptors(vd: VisualDescriptors | undefined): string {
    if (!vd) return ''
    return (
      Object.entries(vd)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n') || '(none)'
    )
  }

  function formatCharacter(
    data: (VaultCharacter & Record<string, unknown>) | Record<string, unknown> | undefined,
  ): string {
    if (!data) return ''
    const lines: string[] = []
    if ('name' in data) lines.push(`Name: ${data.name}`)
    if ('description' in data) lines.push(`Description: ${data.description}`)
    if ('traits' in data && (data.traits as string[])?.length)
      lines.push(`Traits: ${(data.traits as string[]).join(', ')}`)
    if ('visualDescriptors' in data && data.visualDescriptors) {
      const vd = formatVisualDescriptors(data.visualDescriptors as VisualDescriptors)
      if (vd && vd !== '(none)') lines.push(`Appearance:\n${vd}`)
    }
    if ('tags' in data && (data.tags as string[])?.length)
      lines.push(`Tags: ${(data.tags as string[]).join(', ')}`)
    return lines.join('\n')
  }

  function formatEntry(entry: VaultLorebookEntry | undefined): string {
    if (!entry) return ''
    const lines: string[] = []
    if ('name' in entry) lines.push(`Name: ${entry.name}`)
    if ('type' in entry) lines.push(`Type: ${entry.type}`)
    if ('description' in entry) lines.push(`Description: ${entry.description}`)
    if ('keywords' in entry && entry.keywords?.length > 0)
      lines.push(`Keywords: ${entry.keywords.join(', ')}`)
    if ('aliases' in entry && entry.aliases?.length > 0)
      lines.push(`Aliases: ${entry.aliases.join(', ')}`)
    if ('injectionMode' in entry) lines.push(`Injection: ${entry.injectionMode}`)
    if ('priority' in entry) lines.push(`Priority: ${entry.priority}`)
    return lines.join('\n')
  }

  function formatNpc(npc: VaultScenarioNpc): string {
    return [
      `  ${npc.name} (${npc.role})`,
      `    ${npc.description}`,
      `    Relationship: ${npc.relationship}`,
      npc.traits.length > 0 ? `    Traits: ${npc.traits.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  }

  function formatScenario(data: Record<string, unknown> | undefined): string {
    if (!data) return ''
    const lines: string[] = []
    if ('name' in data) lines.push(`Name: ${data.name}`)
    if ('description' in data) lines.push(`Description: ${data.description}`)
    if ('settingSeed' in data && data.settingSeed) {
      const seed = String(data.settingSeed)
      lines.push(`Setting: ${seed.length > 200 ? seed.slice(0, 200) + '...' : seed}`)
    }
    if ('primaryCharacterName' in data) lines.push(`Protagonist: ${data.primaryCharacterName}`)
    if ('npcs' in data && (data.npcs as VaultScenarioNpc[])?.length) {
      lines.push(`NPCs (${(data.npcs as VaultScenarioNpc[]).length}):`)
      for (const npc of data.npcs as VaultScenarioNpc[]) {
        lines.push(formatNpc(npc))
      }
    }
    if ('firstMessage' in data && data.firstMessage) {
      const msg = String(data.firstMessage)
      lines.push(`First Message: ${msg.length > 150 ? msg.slice(0, 150) + '...' : msg}`)
    }
    if ('tags' in data && (data.tags as string[])?.length)
      lines.push(`Tags: ${(data.tags as string[]).join(', ')}`)
    return lines.join('\n')
  }

  function formatLorebook(data: Record<string, unknown> | undefined): string {
    if (!data) return ''
    const lines: string[] = []
    if ('name' in data) lines.push(`Name: ${data.name}`)
    if ('description' in data) lines.push(`Description: ${data.description}`)
    if ('tags' in data && (data.tags as string[])?.length)
      lines.push(`Tags: ${(data.tags as string[]).join(', ')}`)
    return lines.join('\n')
  }

  // --- Computed display data per entity type ---

  function formatChangeData(): string {
    if (!('data' in change)) return ''
    if (change.entityType === 'character') {
      return formatCharacter(change.data as Record<string, unknown>)
    }
    if (change.entityType === 'lorebook-entry') {
      return formatEntry(change.data as VaultLorebookEntry)
    }
    if (change.entityType === 'scenario') {
      return formatScenario(change.data as Record<string, unknown>)
    }
    if (change.entityType === 'lorebook') {
      return formatLorebook(change.data as Record<string, unknown>)
    }
    return ''
  }

  function formatPrevious(): string {
    if (change.entityType === 'character' && 'previous' in change) {
      return formatCharacter(change.previous as Record<string, unknown>)
    }
    if (change.entityType === 'lorebook-entry' && 'previous' in change) {
      return formatEntry(change.previous as VaultLorebookEntry | undefined)
    }
    if (change.entityType === 'scenario' && 'previous' in change) {
      return formatScenario(change.previous as Record<string, unknown>)
    }
    if (change.entityType === 'lorebook' && 'previous' in change) {
      return formatLorebook(change.previous as Record<string, unknown>)
    }
    return ''
  }

  // Merge-specific data (lorebook entries only)
  const mergeData = $derived(
    change.entityType === 'lorebook-entry' && change.action === 'merge' ? change.data : undefined,
  )
  const previousEntries = $derived(
    change.entityType === 'lorebook-entry' && change.action === 'merge'
      ? change.previousEntries
      : undefined,
  )
</script>

<div
  class="overflow-hidden rounded-xl border transition-all {isAutoApproved
    ? 'border-teal-500/20 bg-teal-500/5 opacity-85'
    : isApproved
      ? 'border-emerald-500/20 bg-emerald-500/5 opacity-75'
      : isRejected
        ? 'border-red-500/20 bg-red-500/5 opacity-60'
        : 'border-surface-700 bg-surface-800'}"
  in:fade={{ duration: 150 }}
>
  <!-- Header -->
  <div class="border-surface-700 bg-surface-800 flex items-center gap-2 border-b px-3 py-2">
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <!-- Entity type badge -->
      <div
        class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase {entityConfig.color} {entityConfig.bg}"
      >
        <entityConfig.icon class="h-2.5 w-2.5" />
        {entityConfig.label}
      </div>

      <!-- Action indicator -->
      <div class="flex shrink-0 items-center gap-1 whitespace-nowrap">
        <actionConfig.icon class="h-3.5 w-3.5 {actionConfig.color}" />
        <span class="text-xs font-semibold {actionConfig.color}">
          {actionConfig.label}
        </span>
      </div>

      <!-- Entity name -->
      <span class="text-surface-300 min-w-0 truncate text-xs font-medium">{entityName}</span>
    </div>

    <div class="flex shrink-0 items-center gap-1.5">
      {#if isAutoApproved}
        <div class="flex items-center gap-1 text-xs font-medium text-teal-400">
          <Zap class="h-3 w-3" />
          Auto-approved
        </div>
      {:else if isApproved}
        <div class="flex items-center gap-1 text-xs font-medium text-emerald-400">
          <CheckCircle2 class="h-3 w-3" />
          Approved
        </div>
      {:else if isRejected}
        <div class="flex items-center gap-1 text-xs font-medium text-red-400">
          <XCircle class="h-3 w-3" />
          Rejected
        </div>
      {:else}
        {#if onEdit}
          <button
            class="bg-surface-700 text-surface-300 hover:bg-foreground/5 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
            onclick={onEdit}
          >
            <Pencil class="h-3 w-3" />
            Edit
          </button>
        {/if}
        <button
          class="flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-red-400 transition-colors hover:bg-red-500/25"
          onclick={onReject}
        >
          <X class="h-3 w-3" />
          Reject
        </button>
        <button
          class="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-emerald-400 transition-colors hover:bg-emerald-500/25"
          onclick={onApprove}
        >
          <Check class="h-3 w-3" />
          Approve
        </button>
      {/if}
    </div>
  </div>

  <!-- Content -->
  <div class="p-3">
    {#if change.action === 'create'}
      <!-- Create: Show new entity data -->
      <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-2.5">
        <div class="mb-1.5 text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
          New {entityConfig.label}
        </div>
        <pre
          class="text-surface-200 font-mono text-xs leading-relaxed whitespace-pre-wrap">{formatChangeData()}</pre>
      </div>
    {:else if change.action === 'update'}
      <!-- Update: Before / After -->
      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div class="rounded-lg border border-red-500/20 bg-red-500/8 p-2.5">
          <div class="mb-1.5 text-[10px] font-bold tracking-wider text-red-400 uppercase">
            Before
          </div>
          <pre
            class="text-surface-400 font-mono text-xs leading-relaxed whitespace-pre-wrap">{formatPrevious()}</pre>
        </div>
        <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-2.5">
          <div class="mb-1.5 text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
            After
          </div>
          <pre
            class="text-surface-200 font-mono text-xs leading-relaxed whitespace-pre-wrap">{formatChangeData()}</pre>
        </div>
      </div>
    {:else if change.action === 'delete'}
      <!-- Delete: Show entity being removed -->
      <div class="rounded-lg border border-red-500/20 bg-red-500/8 p-2.5">
        <div class="mb-1.5 text-[10px] font-bold tracking-wider text-red-400 uppercase">
          {entityConfig.label} to Delete
        </div>
        <pre
          class="text-surface-400 font-mono text-xs leading-relaxed whitespace-pre-wrap line-through opacity-70">{formatPrevious()}</pre>
      </div>
    {:else if change.action === 'merge'}
      <!-- Merge: Source entries and result (lorebook-entry only) -->
      <div class="space-y-3">
        <div class="rounded-lg border border-red-500/20 bg-red-500/8 p-2.5">
          <div class="mb-1.5 text-[10px] font-bold tracking-wider text-red-400 uppercase">
            Entries to Merge ({previousEntries?.length ?? 0})
          </div>
          <div class="space-y-1.5">
            {#each previousEntries ?? [] as entry, i (i)}
              <div class="bg-surface-800 rounded-md p-2">
                <div class="text-surface-400 mb-1 text-[10px] font-semibold">
                  Entry {i + 1}: {entry.name}
                </div>
                <pre
                  class="text-surface-300 font-mono text-xs leading-relaxed whitespace-pre-wrap">{formatEntry(
                    entry,
                  )}</pre>
              </div>
            {/each}
          </div>
        </div>

        <div class="flex justify-center">
          <ArrowRight class="h-4 w-4 rotate-90 text-purple-400/70" />
        </div>

        <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-2.5">
          <div class="mb-1.5 text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
            Merged Entry
          </div>
          <pre
            class="text-surface-200 font-mono text-xs leading-relaxed whitespace-pre-wrap">{formatEntry(
              mergeData as VaultLorebookEntry | undefined,
            )}</pre>
        </div>
      </div>
    {/if}
  </div>
</div>
