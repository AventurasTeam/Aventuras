<script lang="ts">
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements'
  import type { WithElementRef } from 'bits-ui'
  import { cn } from '$lib/utils/cn.js'
  import { Label } from '$lib/components/ui/label'
  import { Eye, EyeOff, Search } from '@lucide/svelte'

  type InputType = Exclude<HTMLInputTypeAttribute, 'file'>

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, 'type'> &
      ({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
  > & {
    leftIcon?: typeof Search
    rightIcon?: typeof Search
    label?: string
    fullWidth?: boolean
  }

  let {
    ref = $bindable(null),
    value = $bindable(),
    type,
    files = $bindable(),
    class: className,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    label,
    fullWidth = true,
    ...restProps
  }: Props = $props()

  let showPassword = $state(false)
</script>

{#if label}
  <div class={cn('flex flex-col', fullWidth && 'w-full')}>
    <Label class="mb-2">{label}</Label>
    {#if type === 'file'}
      <input
        bind:this={ref}
        class={cn(
          'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring flex h-10 rounded-md border px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          fullWidth && 'w-full',
          className,
        )}
        type="file"
        bind:files
        bind:value
        {...restProps}
      />
    {:else if type === 'password'}
      <div class={cn('relative flex', fullWidth && 'w-full')}>
        {#if LeftIcon}
          <div
            class="text-muted-foreground absolute top-1/2 left-3 flex -translate-y-1/2 items-center"
          >
            <LeftIcon class="h-4 w-4" />
          </div>
        {/if}
        <input
          bind:this={ref}
          class={cn(
            'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring flex h-10 rounded-md border px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            fullWidth && 'w-full',
            LeftIcon && 'pl-10',
            'pr-10',
            className,
          )}
          type={showPassword ? 'text' : 'password'}
          bind:value
          {...restProps}
        />
        <div
          class="text-muted-foreground absolute top-1/2 right-3 flex -translate-y-1/2 items-center"
        >
          <button
            type="button"
            class="hover:text-foreground transition-colors"
            onclick={() => (showPassword = !showPassword)}
          >
            {#if showPassword}
              <Eye class="h-4 w-4" />
            {:else}
              <EyeOff class="h-4 w-4" />
            {/if}
          </button>
        </div>
      </div>
    {:else}
      <div class={cn('relative flex', fullWidth && 'w-full')}>
        {#if LeftIcon}
          <div
            class="text-muted-foreground absolute top-1/2 left-3 flex -translate-y-1/2 items-center"
          >
            <LeftIcon class="h-4 w-4" />
          </div>
        {/if}
        <input
          bind:this={ref}
          class={cn(
            'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring flex h-10 rounded-md border px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            fullWidth && 'w-full',
            LeftIcon && 'pl-10',
            RightIcon && 'pr-10',
            LeftIcon && RightIcon && 'px-10',
            className,
          )}
          {type}
          bind:value
          {...restProps}
        />
        {#if RightIcon}
          <div
            class="text-muted-foreground absolute top-1/2 right-3 flex -translate-y-1/2 items-center"
          >
            <RightIcon class="h-4 w-4" />
          </div>
        {/if}
      </div>
    {/if}
  </div>
{:else if type === 'file'}
  <input
    bind:this={ref}
    class={cn(
      'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring flex h-10 rounded-md border px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      fullWidth && 'w-full',
      className,
    )}
    type="file"
    bind:files
    bind:value
    {...restProps}
  />
{:else if type === 'password'}
  <div class={cn('relative flex', fullWidth && 'w-full')}>
    {#if LeftIcon}
      <div class="text-muted-foreground absolute top-1/2 left-3 flex -translate-y-1/2 items-center">
        <LeftIcon class="h-4 w-4" />
      </div>
    {/if}
    <input
      bind:this={ref}
      class={cn(
        'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring flex h-10 rounded-md border px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        fullWidth && 'w-full',
        LeftIcon && 'pl-10',
        'pr-10',
        className,
      )}
      type={showPassword ? 'text' : 'password'}
      bind:value
      {...restProps}
    />
    <div class="text-muted-foreground absolute top-1/2 right-3 flex -translate-y-1/2 items-center">
      <button
        type="button"
        class="hover:text-foreground transition-colors"
        onclick={() => (showPassword = !showPassword)}
      >
        {#if showPassword}
          <Eye class="h-4 w-4" />
        {:else}
          <EyeOff class="h-4 w-4" />
        {/if}
      </button>
    </div>
  </div>
{:else}
  <div class={cn('relative flex', fullWidth && 'w-full')}>
    {#if LeftIcon}
      <div class="text-muted-foreground absolute top-1/2 left-3 flex -translate-y-1/2 items-center">
        <LeftIcon class="h-4 w-4" />
      </div>
    {/if}
    <input
      bind:this={ref}
      class={cn(
        'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring flex h-10 rounded-md border px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        fullWidth && 'w-full',
        LeftIcon && 'pl-10',
        RightIcon && 'pr-10',
        LeftIcon && RightIcon && 'px-10',
        className,
      )}
      {type}
      bind:value
      {...restProps}
    />
    {#if RightIcon}
      <div
        class="text-muted-foreground absolute top-1/2 right-3 flex -translate-y-1/2 items-center"
      >
        <RightIcon class="h-4 w-4" />
      </div>
    {/if}
  </div>
{/if}
