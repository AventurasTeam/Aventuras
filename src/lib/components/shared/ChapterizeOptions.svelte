<script lang="ts">
  import { Library, BookOpen, Clock, ScanSearch } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import { Switch } from '$lib/components/ui/switch'

  interface Props {
    chapterizeAfterImport: boolean
    chapterizeIncludeLorebook: boolean
    chapterizeIncludeTimeline: boolean
    chapterizeIncludeClassification: boolean
    onChapterizeAfterImportChange: (v: boolean) => void
    onChapterizeIncludeLorebookChange: (v: boolean) => void
    onChapterizeIncludeTimelineChange: (v: boolean) => void
    onChapterizeIncludeClassificationChange: (v: boolean) => void
  }

  let {
    chapterizeAfterImport,
    chapterizeIncludeLorebook,
    chapterizeIncludeTimeline,
    chapterizeIncludeClassification,
    onChapterizeAfterImportChange,
    onChapterizeIncludeLorebookChange,
    onChapterizeIncludeTimelineChange,
    onChapterizeIncludeClassificationChange,
  }: Props = $props()
</script>

<Card.Root>
  <Card.Content class="space-y-3 p-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Library class="text-muted-foreground h-4 w-4" />
        <span class="text-sm">Generate chapters from history</span>
      </div>
      <Switch
        checked={chapterizeAfterImport}
        onCheckedChange={(v) => onChapterizeAfterImportChange(v)}
        aria-label="Generate chapters from history"
      />
    </div>
    {#if chapterizeAfterImport}
      <div class="border-t pt-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 pl-6">
            <BookOpen class="text-muted-foreground h-4 w-4" />
            <span class="text-muted-foreground text-sm">Also update the lorebook</span>
          </div>
          <Switch
            checked={chapterizeIncludeLorebook}
            onCheckedChange={(v) => onChapterizeIncludeLorebookChange(v)}
            aria-label="Also update the lorebook"
          />
        </div>
        <p class="text-muted-foreground mt-1 pl-6 text-xs">
          One extra AI pass over the whole batch to create and update lorebook entries.
        </p>
      </div>
      <div class="border-t pt-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 pl-6">
            <Clock class="text-muted-foreground h-4 w-4" />
            <span class="text-muted-foreground text-sm">Estimate timeline</span>
          </div>
          <Switch
            checked={chapterizeIncludeTimeline}
            onCheckedChange={(v) => onChapterizeIncludeTimelineChange(v)}
            aria-label="Estimate timeline"
          />
        </div>
        <p class="text-muted-foreground mt-1 pl-6 text-xs">
          Estimates how much in-story time passed in each chapter. Adds 1 AI call per chapter.
        </p>
      </div>
      <div class="border-t pt-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 pl-6">
            <ScanSearch class="text-muted-foreground h-4 w-4" />
            <span class="text-muted-foreground text-sm">Populate characters, locations & items</span
            >
          </div>
          <Switch
            checked={chapterizeIncludeClassification}
            onCheckedChange={(v) => onChapterizeIncludeClassificationChange(v)}
            aria-label="Populate characters, locations & items"
          />
        </div>
        <p class="text-muted-foreground mt-1 pl-6 text-xs">
          Backfills the World Tracking panels from each chapter. Adds 1 AI call per chapter.
        </p>
      </div>
    {/if}
  </Card.Content>
</Card.Root>
