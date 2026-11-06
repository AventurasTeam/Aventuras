<script lang="ts">
  import { Input } from '#lib/components/ui/input/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'

  interface Props {
    name: string
    onRename: (name: string) => void
  }

  let { name, onRename }: Props = $props()
</script>

<div class="mb-4 flex flex-col gap-1">
  <Label for="sync-device-name">This device's name</Label>
  <Input
    id="sync-device-name"
    class="h-10"
    value={name}
    maxlength={40}
    onchange={(e) => {
      const next = e.currentTarget.value.trim()
      if (next) onRename(next)
      else e.currentTarget.value = name
    }}
  />
</div>
