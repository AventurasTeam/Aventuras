<script lang="ts">
  import { User, Users, Edit3, Trash2, Plus } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import { Badge } from '$lib/components/ui/badge'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import type { GeneratedProtagonist, GeneratedCharacter } from '$lib/services/ai/sdk'

  interface Props {
    protagonist: GeneratedProtagonist | null
    manualCharacterName: string
    manualCharacterDescription: string
    manualCharacterBackground: string
    manualCharacterMotivation: string
    manualCharacterTraits: string
    showManualInput: boolean
    supportingCharacters: GeneratedCharacter[]
    cardPortrait: string | null
    onManualNameChange: (v: string) => void
    onManualDescriptionChange: (v: string) => void
    onManualBackgroundChange: (v: string) => void
    onManualMotivationChange: (v: string) => void
    onManualTraitsChange: (v: string) => void
    onUseManualCharacter: () => void
    onEditCharacter: () => void
    onDeleteSupportingCharacter: (i: number) => void
  }

  let {
    protagonist,
    manualCharacterName,
    manualCharacterDescription,
    manualCharacterBackground,
    manualCharacterMotivation,
    manualCharacterTraits,
    showManualInput,
    supportingCharacters,
    cardPortrait,
    onManualNameChange,
    onManualDescriptionChange,
    onManualBackgroundChange,
    onManualMotivationChange,
    onManualTraitsChange,
    onUseManualCharacter,
    onEditCharacter,
    onDeleteSupportingCharacter,
  }: Props = $props()
</script>

<div class="space-y-5">
  <p class="text-muted-foreground">
    Set up your protagonist and review the supporting cast.
  </p>

  <!-- Protagonist Section -->
  <div class="space-y-3">
    <h4 class="flex items-center gap-2 text-sm font-medium">
      <User class="h-4 w-4" />
      Protagonist
      <Badge variant="secondary" class="text-xs">Required</Badge>
    </h4>

    {#if protagonist && !showManualInput}
      <!-- Protagonist Card Display -->
      <Card.Root class="border-primary/20">
        <Card.Content class="p-4">
          <div class="flex items-start gap-3">
            {#if cardPortrait}
              <img
                src={cardPortrait}
                alt={protagonist.name}
                class="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            {/if}
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex items-center justify-between">
                <h5 class="font-medium">{protagonist.name}</h5>
                <Button variant="ghost" size="sm" onclick={onEditCharacter}>
                  <Edit3 class="mr-1 h-3 w-3" />
                  Edit
                </Button>
              </div>
              <p class="text-muted-foreground text-sm">{protagonist.description}</p>
              {#if protagonist.traits.length > 0}
                <div class="mt-2 flex flex-wrap gap-1">
                  {#each protagonist.traits as trait}
                    <Badge variant="outline" class="text-xs">{trait}</Badge>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </Card.Content>
      </Card.Root>
    {:else}
      <!-- Manual Input -->
      <Card.Root>
        <Card.Content class="space-y-3 p-4">
          <div>
            <Label for="protagonist-name">Name</Label>
            <Input
              id="protagonist-name"
              placeholder="Character name"
              value={manualCharacterName}
              oninput={(e) => onManualNameChange(e.currentTarget.value)}
            />
          </div>
          <div>
            <Label for="protagonist-desc">Description</Label>
            <Textarea
              id="protagonist-desc"
              placeholder="Brief character description"
              value={manualCharacterDescription}
              oninput={(e) => onManualDescriptionChange(e.currentTarget.value)}
              rows={2}
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label for="protagonist-bg">Background</Label>
              <Input
                id="protagonist-bg"
                placeholder="Character background"
                value={manualCharacterBackground}
                oninput={(e) => onManualBackgroundChange(e.currentTarget.value)}
              />
            </div>
            <div>
              <Label for="protagonist-motiv">Motivation</Label>
              <Input
                id="protagonist-motiv"
                placeholder="Character motivation"
                value={manualCharacterMotivation}
                oninput={(e) => onManualMotivationChange(e.currentTarget.value)}
              />
            </div>
          </div>
          <div>
            <Label for="protagonist-traits">Traits (comma-separated)</Label>
            <Input
              id="protagonist-traits"
              placeholder="brave, curious, witty"
              value={manualCharacterTraits}
              oninput={(e) => onManualTraitsChange(e.currentTarget.value)}
            />
          </div>
          <Button
            variant="default"
            size="sm"
            onclick={onUseManualCharacter}
            disabled={!manualCharacterName.trim()}
          >
            Confirm Protagonist
          </Button>
        </Card.Content>
      </Card.Root>
    {/if}
  </div>

  <!-- Supporting Cast Section -->
  {#if supportingCharacters.length > 0}
    <div class="space-y-3">
      <h4 class="flex items-center gap-2 text-sm font-medium">
        <Users class="h-4 w-4" />
        Supporting Cast
        <Badge variant="outline" class="text-xs">{supportingCharacters.length}</Badge>
      </h4>

      <ScrollArea class="max-h-[250px]">
        <div class="space-y-2 pr-2">
          {#each supportingCharacters as char, i (i)}
            <Card.Root>
              <Card.Content class="flex items-start justify-between p-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <p class="text-sm font-medium">{char.name}</p>
                    {#if char.role}
                      <Badge variant="secondary" class="text-xs">{char.role}</Badge>
                    {/if}
                  </div>
                  <p class="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                    {char.description}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onclick={() => onDeleteSupportingCharacter(i)}>
                  <Trash2 class="h-3 w-3" />
                </Button>
              </Card.Content>
            </Card.Root>
          {/each}
        </div>
      </ScrollArea>
    </div>
  {/if}
</div>
