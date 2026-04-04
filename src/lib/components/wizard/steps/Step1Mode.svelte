<script lang="ts">
  import { Sword, Feather } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import type { StoryMode } from '$lib/types'

  interface Props {
    selectedMode: StoryMode
    onModeChange: (mode: StoryMode) => void
  }

  let { selectedMode, onModeChange }: Props = $props()
</script>

<div class="space-y-4">
  <p class="text-muted-foreground">How do you want to experience your story?</p>
  <div class="grid gap-4 sm:grid-cols-2">
    <!-- Adventure Mode -->
    <button
      class="group w-full text-left focus:outline-none"
      onclick={() => onModeChange('adventure')}
    >
      <Card.Root
        class="border-border hover:border-primary hover:shadow-primary/5 h-full transition-all duration-200 hover:shadow-md {selectedMode ===
        'adventure'
          ? 'ring-primary border-primary ring-2'
          : ''}"
      >
        <Card.Header>
          <div class="flex items-center gap-4">
            <div class="bg-primary/10 rounded-lg p-3">
              <Sword class="text-primary h-6 w-6" />
            </div>
            <Card.Title>Adventure Mode</Card.Title>
          </div>
        </Card.Header>
        <Card.Content>
          <p class="text-muted-foreground text-sm">
            <strong>You are the protagonist.</strong> Explore the world, interact with characters, and
            make choices that shape your story. The AI narrates the consequences of your actions.
          </p>
        </Card.Content>
      </Card.Root>
    </button>

    <!-- Creative Writing Mode -->
    <button
      class="group w-full text-left focus:outline-none"
      onclick={() => onModeChange('creative-writing')}
    >
      <Card.Root
        class="border-border hover:border-primary hover:shadow-primary/5 h-full transition-all duration-200 hover:shadow-md {selectedMode ===
        'creative-writing'
          ? 'ring-primary border-primary ring-2'
          : ''}"
      >
        <Card.Header>
          <div class="flex items-center gap-4">
            <div class="bg-primary/10 rounded-lg p-3">
              <Feather class="text-primary h-6 w-6" />
            </div>
            <Card.Title>Creative Writing</Card.Title>
          </div>
        </Card.Header>
        <Card.Content>
          <p class="text-muted-foreground text-sm">
            <strong>You are the author.</strong> Direct the story and craft the narrative. The AI collaborates
            with you to write prose following your creative vision.
          </p>
        </Card.Content>
      </Card.Root>
    </button>
  </div>
</div>
