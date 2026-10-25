<script lang="ts">
  import { untrack } from 'svelte'
  import type { ClassifiedTemplates, RefreshScope } from '#lib/services/packs/staleness.ts'
  import { Badge } from '#lib/components/ui/badge/index.ts'
  import { RadioGroup, RadioGroupItem } from '#lib/components/ui/radio-group/index.ts'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import ExplanationFold from '#lib/components/shared/ExplanationFold.svelte'
  import { describeTemplate } from './templateGroups'

  interface Props {
    open: boolean
    packName: string
    classified: ClassifiedTemplates | null
    refreshing: boolean
    onConfirm: (scope: RefreshScope) => void
    onCancel: () => void
  }

  let { open, packName, classified, refreshing, onConfirm, onCancel }: Props = $props()

  function listed(templateIds: string[]) {
    return templateIds
      .map((templateId) => ({ templateId, described: describeTemplate(templateId) }))
      .filter((entry) => entry.described !== null)
      .map((entry) => ({
        templateId: entry.templateId,
        label: entry.described!.isUserHalf
          ? `${entry.described!.name} (user half)`
          : entry.described!.name,
        group: entry.described!.group,
      }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
  }

  let behind = $derived(listed(classified?.behind ?? []))
  let customised = $derived(listed(classified?.customised ?? []))
  let total = $derived(behind.length + customised.length)

  let scope = $state<RefreshScope>('edited')
  // Chosen afresh on each opening, not when the lists reload while it is open.
  $effect(() => {
    if (open) scope = untrack(() => behind.length) > 0 ? 'behind' : 'edited'
  })
</script>

{#snippet templateList(title: string, hint: string, entries: ReturnType<typeof listed>)}
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <h4 class="text-sm font-medium">{title}</h4>
      <Badge variant="secondary">{entries.length}</Badge>
    </div>
    <p class="text-muted-foreground text-xs">{hint}</p>
    <ul class="flex flex-col gap-1 text-sm">
      {#each entries as entry (entry.templateId)}
        <li class="flex items-baseline gap-2">
          <span class="text-muted-foreground shrink-0 text-xs">{entry.group}</span>
          <span>{entry.label}</span>
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

<ActionModal
  {open}
  {onCancel}
  title={`Refresh "${packName}" from the shipped prompts`}
  action={{
    label: 'Replace templates',
    tone: 'overwrite',
    disabled: total === 0,
    onConfirm: () => onConfirm(scope),
  }}
  busy={refreshing}
>
  <ExplanationFold id="pack_refresh_help" summary="What it changes">
    <p>
      Your version of each template you choose is replaced by the one this version of the app ships.
      Templates you have not edited are untouched either way.
    </p>
  </ExplanationFold>

  {#if behind.length > 0}
    {@render templateList(
      'Behind newer shipped text',
      'You edited these, and the app has changed them since.',
      behind,
    )}
  {/if}
  {#if customised.length > 0}
    {@render templateList(
      'Customised',
      'You edited these and the app ships nothing newer for them. Replacing these discards your version for no change.',
      customised,
    )}
  {/if}

  <!-- After the lists, so what each choice replaces is read before it is chosen. -->
  {#if behind.length > 0 && customised.length > 0}
    <RadioGroup bind:value={scope} class="gap-2" disabled={refreshing}>
      <label class="flex items-center gap-2 text-sm">
        <RadioGroupItem value="behind" />
        Only the {behind.length} behind newer shipped text
      </label>
      <label class="flex items-center gap-2 text-sm">
        <RadioGroupItem value="edited" />
        All {total} edited
      </label>
    </RadioGroup>
  {/if}
</ActionModal>
