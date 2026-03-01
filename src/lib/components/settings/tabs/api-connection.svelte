<script lang="ts">
  import { onDestroy } from 'svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import type { APIProfile, ProviderType } from '$lib/types'
  import { fetchModelsFromProvider } from '$lib/services/ai/sdk/providers'
  import { PROVIDERS } from '$lib/services/ai/sdk/providers/config'
  import { Plus, Check, ChevronRight, Key as KeyIcon, Star } from 'lucide-svelte'

  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import { Separator } from '$lib/components/ui/separator'
  import * as Collapsible from '$lib/components/ui/collapsible'
  import IconRow from '$lib/components/ui/icon-row.svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import ProfileForm from '$lib/components/settings/ProfileForm.svelte'

  let editingProfileId = $state<string | null>(null)
  let isNewProfile = $state(false)

  // Form state
  let formName = $state('')
  let formProviderType = $state<ProviderType>('openrouter')
  let formBaseUrl = $state('')
  let formApiKey = $state('')
  let formCustomModels = $state<string[]>([])
  let formFetchedModels = $state<string[]>([])
  let formReasoningModels = $state<string[]>([])
  let formHiddenModels = $state<string[]>([])
  let formFavoriteModels = $state<string[]>([])

  // Auto-save debounce state
  let saveTimeout: ReturnType<typeof setTimeout> | null = null
  let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle')

  // UI state
  let isFetchingModels = $state(false)
  let fetchError = $state<string | null>(null)
  let openCollapsibles = $state<Set<string>>(new Set())

  function startEdit(profile: APIProfile) {
    if (editingProfileId && editingProfileId !== profile.id && !isNewProfile) {
      if (saveTimeout) clearTimeout(saveTimeout)
      autoSaveEdit()
    }

    editingProfileId = profile.id
    isNewProfile = false
    formName = profile.name
    formProviderType = profile.providerType
    formBaseUrl = profile.baseUrl ?? ''
    formApiKey = profile.apiKey
    formCustomModels = [...profile.customModels]
    formFetchedModels = [...profile.fetchedModels]
    formReasoningModels = [...(profile.reasoningModels ?? [])]
    formHiddenModels = [...(profile.hiddenModels ?? [])]
    formFavoriteModels = [...(profile.favoriteModels ?? [])]
    fetchError = null
    openCollapsibles = new SvelteSet([...openCollapsibles, profile.id])
  }

  function startNewProfile() {
    editingProfileId = crypto.randomUUID()
    isNewProfile = true
    formName = ''
    formProviderType = 'openrouter'
    formBaseUrl = ''
    formApiKey = ''
    formCustomModels = []
    formFetchedModels = []
    formReasoningModels = []
    formHiddenModels = []
    formFavoriteModels = []
    fetchError = null
  }

  function cancelEdit() {
    editingProfileId = null
    isNewProfile = false
    fetchError = null
    saveStatus = 'idle'
  }

  async function handleSave() {
    if (!formName.trim()) return

    const profile: APIProfile = {
      id: editingProfileId!,
      name: formName.trim(),
      providerType: formProviderType,
      baseUrl: formBaseUrl.trim().replace(/\/$/, '') || undefined,
      apiKey: formApiKey,
      customModels: formCustomModels,
      fetchedModels: formFetchedModels,
      reasoningModels: formReasoningModels,
      hiddenModels: formHiddenModels,
      favoriteModels: formFavoriteModels,
      createdAt: isNewProfile
        ? Date.now()
        : settings.apiSettings.profiles.find((p) => p.id === editingProfileId)?.createdAt ||
          Date.now(),
    }

    if (isNewProfile) {
      await settings.addProfile(profile)
    } else {
      await settings.updateProfile(profile.id, profile)
    }

    cancelEdit()
  }

  async function handleDelete(profileId: string) {
    await settings.deleteProfile(profileId)
    if (editingProfileId === profileId) cancelEdit()
  }

  async function handleFetchModels() {
    isFetchingModels = true
    fetchError = null
    formFetchedModels = []
    formReasoningModels = []

    try {
      const result = await fetchModelsFromProvider(formProviderType, formBaseUrl, formApiKey)
      // Exclude models the user has explicitly hidden so they don't reappear on refresh
      const hidden = new Set(formHiddenModels)
      formFetchedModels = result.models.filter((m) => !hidden.has(m))
      formReasoningModels = result.reasoningModels
    } catch (err) {
      fetchError = err instanceof Error ? err.message : 'Failed to fetch models'
    } finally {
      isFetchingModels = false
    }
  }

  function handleRemoveCustomModel(model: string) {
    formCustomModels = formCustomModels.filter((m) => m !== model)
  }

  function handleRemoveFetchedModel(model: string) {
    formFetchedModels = formFetchedModels.filter((m) => m !== model)
    if (!formHiddenModels.includes(model)) {
      formHiddenModels = [...formHiddenModels, model]
    }
    // Also remove from favorites if hidden
    formFavoriteModels = formFavoriteModels.filter((m) => m !== model)
  }

  function handleRestoreHiddenModel(model: string) {
    formHiddenModels = formHiddenModels.filter((m) => m !== model)
    if (!formFetchedModels.includes(model) && !formCustomModels.includes(model)) {
      formFetchedModels = [...formFetchedModels, model]
    }
  }

  function handleToggleFavorite(model: string) {
    if (formFavoriteModels.includes(model)) {
      formFavoriteModels = formFavoriteModels.filter((m) => m !== model)
    } else {
      formFavoriteModels = [...formFavoriteModels, model]
    }
  }

  function handleAddCustomModel(model: string) {
    if (model && !formCustomModels.includes(model)) {
      formCustomModels = [...formCustomModels, model]
      // Custom models are favorites by default
      if (!formFavoriteModels.includes(model)) {
        formFavoriteModels = [...formFavoriteModels, model]
      }
    }
  }

  function handleSetDefault(profileId: string) {
    const currentDefault = settings.apiSettings.defaultProfileId
    // Only allow setting a new default, not unsetting
    if (currentDefault !== profileId) {
      settings.setDefaultProfile(profileId)
    }
  }

  function handleOpenChange(open: boolean, profile: APIProfile) {
    if (open) {
      startEdit(profile)
    } else {
      openCollapsibles.delete(profile.id)
      openCollapsibles = new SvelteSet(openCollapsibles)

      if (editingProfileId === profile.id) {
        if (saveTimeout) clearTimeout(saveTimeout)
        autoSaveEdit()
        editingProfileId = null
      }
    }
  }

  function isProfileOpen(profileId: string): boolean {
    return openCollapsibles.has(profileId)
  }

  async function autoSaveEdit() {
    if (!editingProfileId || isNewProfile) return
    if (!formName.trim()) return

    const existingProfile = settings.apiSettings.profiles.find((p) => p.id === editingProfileId)
    if (!existingProfile) return

    const profile: APIProfile = {
      id: editingProfileId,
      name: formName.trim(),
      providerType: formProviderType,
      baseUrl: formBaseUrl.trim().replace(/\/$/, '') || undefined,
      apiKey: formApiKey,
      customModels: formCustomModels,
      fetchedModels: formFetchedModels,
      reasoningModels: formReasoningModels,
      hiddenModels: formHiddenModels,
      favoriteModels: formFavoriteModels,
      createdAt: existingProfile.createdAt,
    }

    saveStatus = 'saving'
    await settings.updateProfile(profile.id, profile)
    saveStatus = 'saved'
    setTimeout(() => {
      saveStatus = 'idle'
    }, 2000)
  }

  function triggerAutoSave() {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      autoSaveEdit()
      saveTimeout = null
    }, 500)
  }

  $effect(() => {
    if (editingProfileId && !isNewProfile) {
      const _ = [
        formName,
        formProviderType,
        formBaseUrl,
        formApiKey,
        formCustomModels,
        formFetchedModels,
        formHiddenModels,
        formFavoriteModels,
      ]
      triggerAutoSave()
    }
  })

  onDestroy(() => {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
      saveTimeout = null
    }
  })

  // Fix #1: shared handler to avoid duplication between new-profile and edit forms
  function handleProviderTypeChange(v: ProviderType) {
    formProviderType = v
    formName = PROVIDERS[v].name
    formBaseUrl = ''
    formFetchedModels = []
    formReasoningModels = []
    formCustomModels = []
    formHiddenModels = []
    formFavoriteModels = []
    fetchError = null
  }
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">API Profiles</h3>
        <p class="text-muted-foreground text-sm">Setup your API endpoints</p>
      </div>
      <Button onclick={startNewProfile}>
        <Plus class="h-4 w-4" />
        Add Profile
      </Button>
    </div>
  </div>

  <!-- New Profile Form -->
  {#if isNewProfile && editingProfileId}
    <Card class="border-primary/50 bg-primary/5">
      <CardContent>
        <div class="mb-3 flex items-center gap-2">
          <Star class="text-primary h-4 w-4" />
          <span class="text-primary text-sm font-medium">New Profile</span>
        </div>

        <Separator class="mb-4" />

        <ProfileForm
          bind:name={formName}
          bind:providerType={formProviderType}
          bind:baseUrl={formBaseUrl}
          bind:apiKey={formApiKey}
          bind:fetchedModels={formFetchedModels}
          bind:customModels={formCustomModels}
          bind:reasoningModels={formReasoningModels}
          bind:hiddenModels={formHiddenModels}
          bind:favoriteModels={formFavoriteModels}
          {isFetchingModels}
          {fetchError}
          onFetchModels={handleFetchModels}
          onProviderTypeChange={handleProviderTypeChange}
          onRemoveFetchedModel={handleRemoveFetchedModel}
          onRemoveCustomModel={handleRemoveCustomModel}
          onRestoreHiddenModel={handleRestoreHiddenModel}
          onToggleFavorite={handleToggleFavorite}
          onAddCustomModel={handleAddCustomModel}
        >
          {#snippet footer()}
            <div class="flex gap-2 pt-2">
              <Button variant="outline" onclick={cancelEdit} class="flex-1">Cancel</Button>
              <Button
                onclick={handleSave}
                disabled={!formName.trim() ||
                  (formProviderType === 'openai-compatible' && !formBaseUrl.trim())}
                class="flex-1"
              >
                <Check class="h-4 w-4" />
                Create Profile
              </Button>
            </div>
          {/snippet}
        </ProfileForm>
      </CardContent>
    </Card>
  {/if}

  <!-- Profiles List -->
  <div class="space-y-3">
    {#each settings.apiSettings.profiles as profile (profile.id)}
      <div class="bg-card text-card-foreground group rounded-lg border shadow-sm">
        <Collapsible.Root
          open={isProfileOpen(profile.id)}
          onOpenChange={(open) => handleOpenChange(open, profile)}
        >
          <div class="flex items-center gap-3 p-3 pl-4">
            <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
              <div
                class="bg-muted/50 group-hover/trigger:bg-muted flex h-8 w-8 items-center justify-center rounded-md transition-colors"
              >
                <ChevronRight
                  class="h-4 w-4 transition-transform duration-200 group-data-[state=open]/trigger:rotate-90"
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-xl font-medium md:text-sm">{profile.name}</span>
                  {#if profile.id === settings.getDefaultProfileIdForProvider()}
                    <Badge
                      variant="default"
                      class="hidden shrink-0 items-center justify-center md:flex"
                      title="Used when agent profiles don't specify an API profile"
                    >
                      <Star class="mr-1 h-3 w-3" />
                      Fallback
                    </Badge>
                  {/if}
                </div>
                <div class="mt-0.5 hidden items-center gap-2 md:flex">
                  <Badge variant="secondary" class="text-xs capitalize">
                    {profile.providerType}
                  </Badge>
                  <Badge variant="outline" class="text-muted-foreground text-xs">
                    {new Set([...profile.fetchedModels, ...profile.customModels]).size}
                    models
                  </Badge>
                </div>
              </div>
            </Collapsible.Trigger>
            <div class="flex shrink-0 items-center gap-1">
              <IconRow
                onDelete={() => handleDelete(profile.id)}
                size="icon"
                showDelete={settings.canDeleteProfile(profile.id)}
              >
                {#if profile.id === settings.getDefaultProfileIdForProvider()}
                  <Badge
                    variant="default"
                    class="shrink-0 text-xs md:hidden"
                    title="Used when agent profiles don't specify an API profile"
                  >
                    Fallback
                  </Badge>
                {/if}
                {#if settings.apiSettings.profiles.length > 1 && profile.id !== settings.apiSettings.defaultProfileId}
                  <Button
                    variant="text"
                    size="icon"
                    class="w-5"
                    onclick={() => handleSetDefault(profile.id)}
                    title="Set as fallback profile"
                  >
                    <Star class="h-4 w-4" />
                  </Button>
                {/if}
              </IconRow>
            </div>
          </div>

          <Collapsible.Content>
            <div class="bg-muted/10 mt-2 border-t p-4">
              <ProfileForm
                bind:name={formName}
                bind:providerType={formProviderType}
                bind:baseUrl={formBaseUrl}
                bind:apiKey={formApiKey}
                bind:fetchedModels={formFetchedModels}
                bind:customModels={formCustomModels}
                bind:reasoningModels={formReasoningModels}
                bind:hiddenModels={formHiddenModels}
                bind:favoriteModels={formFavoriteModels}
                {isFetchingModels}
                {fetchError}
                onFetchModels={handleFetchModels}
                onProviderTypeChange={handleProviderTypeChange}
                onRemoveFetchedModel={handleRemoveFetchedModel}
                onRemoveCustomModel={handleRemoveCustomModel}
                onRestoreHiddenModel={handleRestoreHiddenModel}
                onToggleFavorite={handleToggleFavorite}
                onAddCustomModel={handleAddCustomModel}
              />
              {#if saveStatus !== 'idle'}
                <p class="text-muted-foreground mt-2 text-right text-xs">
                  {#if saveStatus === 'saving'}
                    Saving...
                  {:else}
                    ✓ Saved
                  {/if}
                </p>
              {/if}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      </div>
    {/each}

    {#if settings.apiSettings.profiles.length === 0}
      <Card class="border-dashed">
        <CardContent class="p-8 text-center">
          <div
            class="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          >
            <KeyIcon class="text-muted-foreground h-6 w-6" />
          </div>
          <h4 class="mb-2 font-medium">No API profiles yet</h4>
          <p class="text-muted-foreground mb-4 text-sm">
            Add an API profile to connect to your LLM provider
          </p>
          <Button onclick={startNewProfile}>
            <Plus class=" h-4 w-4" />
            Add Your First Profile
          </Button>
        </CardContent>
      </Card>
    {/if}
  </div>
</div>
