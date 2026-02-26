<script lang="ts">
  import type { VaultLorebookEntry } from '$lib/types'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import SelectTrigger from '../ui/select/select-trigger.svelte'
  import { Select, SelectContent, SelectItem } from '../ui/select'
  import type { EntryType, EntryInjectionMode } from '$lib/types'

  interface Props {
    data: VaultLorebookEntry
    onUpdate: (data: VaultLorebookEntry) => void
    changedFields?: Set<string>
  }

  let { data, onUpdate, changedFields }: Props = $props()

  const changed = (field: string) =>
    changedFields?.has(field)
      ? 'border-l-2 border-l-blue-400/50 bg-blue-500/5 pl-3 -ml-3 rounded-lg'
      : ''

  // Type options
  const entryTypes: EntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'event']
  const injectionModes: Array<{ value: EntryInjectionMode; label: string; description: string }> = [
    { value: 'always', label: 'Always Active', description: 'Always included in every response' },
    { value: 'keyword', label: 'Automatic', description: 'Matched by keywords or AI relevance' },
    { value: 'never', label: 'Disabled', description: 'Not included in AI context' },
  ]

  function handleInput() {
    onUpdate({ ...data })
  }
</script>

<div class="space-y-6">
  <div class="space-y-2 {changed('name')}">
    <Label for="entry-name">Entry Name</Label>
    <Input id="entry-name" bind:value={data.name} oninput={handleInput} placeholder="Entry Name" />
  </div>

  <div class="space-y-2 {changed('type')}">
    <Label>Entry Type</Label>
    <Select
      type="single"
      value={data.type}
      onValueChange={(v) => {
        data.type = v as EntryType
        handleInput()
      }}
    >
      <SelectTrigger id="entry-type">
        {`${data.type.charAt(0).toUpperCase() + data.type.slice(1)}` || 'Select type'}
      </SelectTrigger>
      <SelectContent>
        {#each entryTypes as option (option)}
          <SelectItem value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <div class="space-y-2 {changed('keywords')}">
    <Label>Keywords</Label>
    <Input
      value={data.keywords?.join(', ') ?? ''}
      oninput={(e) => {
        data.keywords = e.currentTarget.value
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
        handleInput()
      }}
      placeholder="Comma-separated keywords..."
    />
    <p class="text-muted-foreground text-[0.8rem]">
      Terms that trigger this entry when using 'Keyword' injection mode.
    </p>
  </div>

  <div class="space-y-2 {changed('aliases')}">
    <Label>Aliases</Label>
    <Input
      value={data.aliases?.join(', ') ?? ''}
      oninput={(e) => {
        data.aliases = e.currentTarget.value
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
        handleInput()
      }}
      placeholder="Comma-separated alternative names..."
    />
    <p class="text-muted-foreground text-[0.8rem]">
      Alternative names or spellings for this entry.
    </p>
  </div>

  <div class="flex flex-1 flex-col space-y-2 {changed('description')}">
    <Label>Description / Content</Label>
    <Textarea
      bind:value={data.description}
      oninput={handleInput}
      class="min-h-[200px] font-mono text-sm leading-relaxed"
      placeholder="Enter the lore content here..."
    />
  </div>

  <div class="bg-muted/30 space-y-4 rounded-lg border p-4">
    <h4 class="text-sm font-medium">Injection Settings</h4>

    <div class="grid grid-cols-1 items-center gap-4 md:grid-cols-2">
      <div class="space-y-2 {changed('injectionMode')}">
        <Label class="text-xs">Injection Mode</Label>
        <Select
          type="single"
          value={data.injectionMode}
          onValueChange={(v) => {
            data.injectionMode = v as EntryInjectionMode
            handleInput()
          }}
        >
          <SelectTrigger id="injection-mode">
            {injectionModes.find((m) => m.value === data.injectionMode)?.label || 'Select mode'}
          </SelectTrigger>
          <SelectContent>
            {#each injectionModes as mode (mode.value)}
              <SelectItem value={mode.value}>{mode.label}</SelectItem>
            {/each}
          </SelectContent>
        </Select>
        <p class="text-muted-foreground text-[0.8rem]">
          {injectionModes.find((m) => m.value === data.injectionMode)?.description || ''}
        </p>
      </div>

      <div class="space-y-2 {changed('priority')}">
        <Label class="text-xs">Priority</Label>
        <Input type="number" bind:value={data.priority} oninput={handleInput} />
      </div>
    </div>
  </div>
</div>
