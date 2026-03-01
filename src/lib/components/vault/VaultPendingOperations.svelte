<script lang="ts">
  import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas/vault'
  import {
    GitMerge,
    Plus,
    Pencil,
    Trash2,
    ChevronDown,
    ChevronUp,
    Check,
    CheckCheck,
  } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils/cn'
  import { slide } from 'svelte/transition'
  import X from '@lucide/svelte/icons/x'

  /**
   * A grouped operation — merges group multiple changes under one card;
   * creates/edits/deletes are 1:1 with their pending change.
   */
  export type PendingOperation = {
    id: string
    type: 'merge' | 'create' | 'edit' | 'delete'
    /** Human-readable summary line */
    summary: string
    /** The primary change to approve (merge result, or the single change) */
    primaryChange: VaultPendingChange
    /** All related changes (merge: sources + result; otherwise just the one) */
    relatedChanges: VaultPendingChange[]
    /** For merges: names of entries being combined */
    sourceNames?: string[]
    /** For merges: name of the resulting entry */
    resultName?: string
    /** For edits: the entry name */
    entryName?: string
  }

  interface Props {
    operations: PendingOperation[]
    selectedOperationId?: string | null
    onSelectOperation: (op: PendingOperation) => void
    onApproveOperation: (op: PendingOperation) => void
    onRejectOperation: (op: PendingOperation) => void
    onApproveAll: () => void
  }

  let {
    operations,
    selectedOperationId = null,
    onSelectOperation,
    onApproveOperation,
    onRejectOperation,
    onApproveAll,
  }: Props = $props()

  let collapsed = $state(false)

  const typeConfig = {
    merge: {
      icon: GitMerge,
      label: 'MERGE',
      borderColor: 'border-l-amber-500',
      bgColor: 'bg-amber-500/5',
      bgHover: 'hover:bg-amber-500/10',
      badgeColor: 'bg-amber-500/15 text-amber-400',
      btnColor: 'bg-amber-600 hover:bg-amber-700',
    },
    create: {
      icon: Plus,
      label: 'NEW',
      borderColor: 'border-l-emerald-500',
      bgColor: 'bg-emerald-500/5',
      bgHover: 'hover:bg-emerald-500/10',
      badgeColor: 'bg-emerald-500/15 text-emerald-400',
      btnColor: 'bg-emerald-600 hover:bg-emerald-700',
    },
    edit: {
      icon: Pencil,
      label: 'EDIT',
      borderColor: 'border-l-blue-500',
      bgColor: 'bg-blue-500/5',
      bgHover: 'hover:bg-blue-500/10',
      badgeColor: 'bg-blue-500/15 text-blue-400',
      btnColor: 'bg-blue-600 hover:bg-blue-700',
    },
    delete: {
      icon: Trash2,
      label: 'DELETE',
      borderColor: 'border-l-red-500',
      bgColor: 'bg-red-500/5',
      bgHover: 'hover:bg-red-500/10',
      badgeColor: 'bg-red-500/15 text-red-400',
      btnColor: 'bg-red-600 hover:bg-red-700',
    },
  }
</script>

{#if operations.length > 0}
  <div class="border-surface-700 border-b" transition:slide={{ duration: 200 }}>
    <!-- Header -->
    <button
      class="bg-surface-800 hover:bg-foreground/5 flex w-full items-center justify-between px-3 py-2 text-left transition-colors"
      onclick={() => (collapsed = !collapsed)}
    >
      <div class="flex items-center gap-2">
        <div class="flex h-4.5 w-4.5 items-center justify-center rounded-md bg-amber-500/15">
          {#if collapsed}
            <ChevronDown class="h-3 w-3 text-amber-400" />
          {:else}
            <ChevronUp class="h-3 w-3 text-amber-400" />
          {/if}
        </div>
        <span class="text-surface-200 text-xs font-semibold">Pending</span>
        <span
          class="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400"
        >
          {operations.length}
        </span>
      </div>
      {#if operations.length > 1}
        <Button
          size="sm"
          variant="ghost"
          class="text-surface-400 hover:text-foreground h-6 gap-1 px-2 text-[10px]"
          onclick={(e: MouseEvent) => {
            e.stopPropagation()
            onApproveAll()
          }}
        >
          <CheckCheck class="h-3 w-3" />
          Approve All
        </Button>
      {/if}
    </button>

    <!-- Operation Cards -->
    {#if !collapsed}
      <div class="space-y-0.5 px-1.5 py-1.5" transition:slide={{ duration: 150 }}>
        {#each operations as op (op.id)}
          {@const config = typeConfig[op.type]}
          {@const Icon = config.icon}
          {@const isSelected = selectedOperationId === op.id}
          <div
            class={cn(
              'group flex items-center gap-2 rounded-lg border-l-2 px-2.5 py-2 transition-all',
              config.borderColor,
              config.bgColor,
              config.bgHover,
              isSelected && 'ring-accent-400/30 ring-1',
            )}
          >
            <!-- Icon + Content -->
            <button
              class="flex min-w-0 flex-1 items-center gap-2 text-left"
              onclick={() => onSelectOperation(op)}
            >
              <div class="flex-shrink-0">
                <Icon class="h-3.5 w-3.5 opacity-60" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span
                    class={cn(
                      'rounded-md px-1 py-0.5 text-[9px] leading-none font-bold tracking-wider uppercase',
                      config.badgeColor,
                    )}
                  >
                    {config.label}
                  </span>
                  <span class="text-surface-300 truncate text-xs">{op.summary}</span>
                </div>
              </div>
            </button>

            <!-- Actions -->
            <div class="flex flex-shrink-0 items-center gap-0.5">
              <Button
                size="sm"
                class={cn('h-6 w-6 p-0 text-white', config.btnColor)}
                onclick={() => onApproveOperation(op)}
              >
                <Check class="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="text-surface-500 hover:bg-foreground/5 hover:text-foreground h-6 w-6 p-0"
                onclick={() => onRejectOperation(op)}
                title="Reject"
              >
                <X class="h-3 w-3" />
              </Button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
