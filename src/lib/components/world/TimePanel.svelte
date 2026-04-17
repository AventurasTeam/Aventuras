<script lang="ts">
  import { story } from '$lib/stores/story/index.svelte'
  import { Pencil, RotateCcw, Save } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'

  let isEditing = $state(false)
  let editYears = $state(0)
  let editDays = $state(0)
  let editHours = $state(0)
  let editMinutes = $state(0)

  function startEdit() {
    const time = story.time.timeTracker
    editYears = time.years
    editDays = time.days
    editHours = time.hours
    editMinutes = time.minutes
    isEditing = true
  }

  function cancelEdit() {
    isEditing = false
  }

  async function saveEdit() {
    await story.time.setTimeTracker({
      years: Math.max(0, Number(editYears) || 0),
      days: Math.max(0, Number(editDays) || 0),
      hours: Math.max(0, Number(editHours) || 0),
      minutes: Math.max(0, Number(editMinutes) || 0),
    })
    isEditing = false
  }

  async function resetTime() {
    const confirmed = await new Promise<boolean>((resolve) => {
      const result = confirm('Reset time to zero? This cannot be undone.')
      resolve(result)
    })
    if (!confirmed) return
    await story.time.setTimeTracker({ years: 0, days: 0, hours: 0, minutes: 0 })
  }

  // Helper to pad numbers for display
  function pad(n: number, width: number = 2): string {
    return n.toString().padStart(width, '0')
  }
</script>

<div class="flex flex-col gap-1 pb-12">
  <!-- Header -->
  <div class="mb-2 flex items-center justify-between">
    <h3 class="text-foreground text-xl font-bold tracking-tight">Time</h3>
    {#if !isEditing}
      <div class="flex items-center gap-1">
        <Button
          variant="text"
          size="icon"
          class="text-muted-foreground hover:text-foreground h-6 w-6"
          onclick={startEdit}
          title="Edit time"
        >
          <Pencil class="h-4 w-4" />
        </Button>
        <Button
          variant="text"
          size="icon"
          class="text-muted-foreground hover:text-destructive h-6 w-6"
          onclick={resetTime}
          title="Reset time"
        >
          <RotateCcw class="h-4 w-4" />
        </Button>
      </div>
    {/if}
  </div>

  {#if isEditing}
    <div class="border-border bg-card rounded-lg border p-3 shadow-sm">
      <div class="mb-3 grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <Label class="text-xs">Years</Label>
          <Input type="number" bind:value={editYears} min="0" class="h-8 text-sm" />
        </div>
        <div class="space-y-1">
          <Label class="text-xs">Days</Label>
          <Input type="number" bind:value={editDays} min="0" max="364" class="h-8 text-sm" />
        </div>
        <div class="space-y-1">
          <Label class="text-xs">Hours</Label>
          <Input type="number" bind:value={editHours} min="0" max="23" class="h-8 text-sm" />
        </div>
        <div class="space-y-1">
          <Label class="text-xs">Minutes</Label>
          <Input type="number" bind:value={editMinutes} min="0" max="59" class="h-8 text-sm" />
        </div>
      </div>

      <p class="text-muted-foreground mb-3 text-xs">Time will be automatically normalized.</p>

      <div class="border-border flex justify-end gap-2 border-t pt-2">
        <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelEdit}>Cancel</Button>
        <Button size="sm" class="h-7 px-4 text-xs" onclick={saveEdit}>
          <Save class="h-3.5 w-3.5" />
          Save
        </Button>
      </div>
    </div>
  {:else}
    <div class="group border-border bg-card rounded-lg border p-3 shadow-sm transition-all">
      <!-- Detailed time display -->
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="bg-muted/50 border-border/50 rounded border p-2">
          <div class="text-foreground text-lg font-medium">
            {story.time.timeTracker.years}
          </div>
          <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Years
          </div>
        </div>
        <div class="bg-muted/50 border-border/50 rounded border p-2">
          <div class="text-foreground text-lg font-medium">
            {story.time.timeTracker.days}
          </div>
          <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Days
          </div>
        </div>
        <div class="bg-muted/50 border-border/50 rounded border p-2">
          <div class="text-foreground text-lg font-medium">
            {pad(story.time.timeTracker.hours)}
          </div>
          <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Hours
          </div>
        </div>
        <div class="bg-muted/50 border-border/50 rounded border p-2">
          <div class="text-foreground text-lg font-medium">
            {pad(story.time.timeTracker.minutes)}
          </div>
          <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Min
          </div>
        </div>
      </div>
    </div>

    <p class="text-muted-foreground mt-2 px-1 text-xs">
      Time is tracked automatically as the story progresses.
    </p>
  {/if}
</div>
