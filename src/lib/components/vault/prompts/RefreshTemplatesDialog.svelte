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

  type Listed = ReturnType<typeof listed>

  /** The entries under their group, groups in the order the list already has them. */
  function grouped(entries: Listed): { group: string; members: Listed }[] {
    const groups: { group: string; members: Listed }[] = []
    for (const entry of entries) {
      const found = groups.find((candidate) => candidate.group === entry.group)
      if (found) found.members.push(entry)
      else groups.push({ group: entry.group, members: [entry] })
    }
    return groups
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

{#snippet templateList(title: string, hint: string, entries: Listed)}
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <h4 class="text-sm font-medium">{title}</h4>
      <Badge variant="secondary">{entries.length}</Badge>
    </div>
    <p class="text-muted-foreground text-xs">{hint}</p>
    <dl class="flex flex-col gap-2 text-sm">
      {#each grouped(entries) as { group, members } (group)}
        <div>
          <dt class="text-muted-foreground text-xs">{group}</dt>
          <dd>
            <ul class="border-border ml-1 border-l pl-3">
              {#each members as entry (entry.templateId)}
                <li>{entry.label}</li>
              {/each}
            </ul>
          </dd>
        </div>
      {/each}
    </dl>
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
      Every edited template in the set you pick below goes back to the text this version of the app
      ships, and your version of it is lost. Templates you have not edited stay as they are.
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
    <div class="border-border flex flex-col gap-2 border-t pt-3">
      <p id="refresh-scope-label" class="text-sm font-medium">
        Which templates should be replaced?
      </p>
      <RadioGroup
        bind:value={scope}
        class="gap-2"
        disabled={refreshing}
        aria-labelledby="refresh-scope-label"
      >
        <label class="flex items-center gap-2 text-sm">
          <RadioGroupItem value="behind" />
          Only the {behind.length} behind newer shipped text
        </label>
        <label class="flex items-center gap-2 text-sm">
          <RadioGroupItem value="edited" />
          All {total} edited
        </label>
      </RadioGroup>
    </div>
  {/if}
</ActionModal>
