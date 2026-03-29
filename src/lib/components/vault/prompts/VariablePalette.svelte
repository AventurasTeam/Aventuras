<script lang="ts">
  import {
    getDisplayGroupsForTemplate,
    getVariablesForTemplate,
  } from '$lib/services/templates/templateContextMap'
  import type { CustomVariable } from '$lib/services/packs/types'
  import * as Popover from '$lib/components/ui/popover'
  import * as Command from '$lib/components/ui/command'
  import { Braces } from 'lucide-svelte'

  interface Props {
    templateId: string
    customVariables: CustomVariable[]
    onInsert: (variableName: string) => void
    iconOnly?: boolean
  }

  let { templateId, customVariables, onInsert, iconOnly = false }: Props = $props()

  let open = $state(false)

  let displayGroups = $derived.by(() => {
    const groups = getDisplayGroupsForTemplate(templateId)
    const allVars = getVariablesForTemplate(templateId)
    const varMap = new Map(allVars.map((v) => [v.name, v]))
    return groups.map((g) => ({
      label: g.label,
      variables: g.variables.map((name) => varMap.get(name)).filter((v) => v != null),
    }))
  })

  function handleSelect(variableName: string) {
    onInsert(variableName)
    open = false
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      {#if iconOnly}
        <button
          {...props}
          type="button"
          title="Insert Variable"
          class="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
        >
          <Braces class="h-3.5 w-3.5" />
        </button>
      {:else}
        <button
          {...props}
          type="button"
          class="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors"
        >
          <Braces class="h-4 w-4" />
          <span class="hidden sm:inline">Insert Variable</span>
        </button>
      {/if}
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-80 p-0" align="start" side="bottom">
    <Command.Root>
      <Command.Input placeholder="Search variables..." />
      <Command.List class="max-h-75">
        <Command.Empty>No variable found.</Command.Empty>

        {#each displayGroups as group (group.label)}
          <Command.Group heading={group.label}>
            {#each group.variables as v (v.name)}
              <Command.Item value={v.name} onSelect={() => handleSelect(v.name)}>
                <span class="font-mono text-xs">{v.name}</span>
                <span class="text-muted-foreground ml-auto truncate text-xs">{v.description}</span>
              </Command.Item>
            {/each}
          </Command.Group>
          <Command.Separator />
        {/each}

        {#if customVariables.length > 0}
          <Command.Group heading="Custom">
            {#each customVariables as v (v.id)}
              <Command.Item value={v.variableName} onSelect={() => handleSelect(v.variableName)}>
                <span class="font-mono text-xs">{v.variableName}</span>
                <span class="text-muted-foreground ml-auto truncate text-xs">{v.displayName}</span>
              </Command.Item>
            {/each}
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
