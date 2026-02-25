<script lang="ts">
  import type { ProviderType } from '$lib/types'
  import { getProviderList } from '$lib/services/ai/sdk/providers/config'
  import Autocomplete from '$lib/components/ui/autocomplete/Autocomplete.svelte'
  import { Label } from '$lib/components/ui/label'

  interface Props {
    value: ProviderType
    onchange: (value: ProviderType) => void
    label?: string
  }

  let { value, onchange, label = 'Provider' }: Props = $props()

  const providers = getProviderList()

  let currentProvider = $derived(providers.find((p) => p.value === value))
</script>

<div class="space-y-2">
  {#if label}
    <Label>{label}</Label>
  {/if}
  <Autocomplete
    items={providers}
    selected={currentProvider}
    onSelect={(v) => {
      if (v) {
        const provider = v as { value: ProviderType }
        if (provider.value !== value) {
          onchange(provider.value)
        }
      }
    }}
    itemLabel={(p) => p.label}
    itemValue={(p) => p.value}
    placeholder="Select provider"
    searchPlaceholder="Search providers..."
    itemHeight={48}
  >
    {#snippet itemSnippet(provider)}
      <div class="flex flex-col">
        <span class="text-sm font-medium">{provider.label}</span>
        <span class="text-muted-foreground text-xs leading-tight">{provider.description}</span>
      </div>
    {/snippet}
  </Autocomplete>
</div>
