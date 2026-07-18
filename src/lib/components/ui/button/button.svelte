<script lang="ts" module>
  import type { WithElementRef } from 'bits-ui'
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements'
  import { type VariantProps, tv } from 'tailwind-variants'

  export const buttonVariants = tv({
    base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'text-foreground hover:text-destructive',
        outline: 'border-input bg-background hover:bg-accent hover:text-accent-foreground border',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        text: 'text-foreground hover:text-primary/80',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  })

  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant']
  export type ButtonSize = VariantProps<typeof buttonVariants>['size']

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant
      size?: ButtonSize
      // ResponsiveButton props

      icon?: any
      label?: string
      mobileLabel?: string
      mobileVariant?: ButtonVariant
      iconClass?: string

      endIcon?: any
    }
</script>

<script lang="ts">
  import { cn } from '$lib/utils/cn.js'

  let {
    class: className,
    variant = 'default',
    size = 'default',
    ref = $bindable(null),
    href = undefined,
    type = 'button',
    children,
    // Responsive Props
    icon: Icon,
    label,
    mobileLabel,
    mobileVariant,
    iconClass,
    endIcon: EndIcon,
    title,
    ...restProps
  }: ButtonProps = $props()

  // Determine if we are in "Responsive Mode" (Icon/Label provided)
  let isResponsive = $derived(!!(Icon || label || mobileLabel || mobileVariant))

  // If responsive mode and no class override, use ResponsiveButton default
  // ResponsiveButton default: "h-10 w-10 sm:w-auto sm:h-10 sm:px-4"
  let effectiveClass = $derived.by(() => {
    if (isResponsive && !className) {
      return 'h-10 w-10 sm:w-auto sm:h-10 sm:px-4'
    }
    return className
  })

  let finalMobileVariant = $derived(mobileVariant ?? variant)
  let needsDualRender = $derived(mobileVariant && mobileVariant !== variant)

  // ResponsiveButton logic for icons:
  // Desktop: h-4 w-4 (default)
  // Mobile: h-5 w-5 (default)
  let defaultIconClass = $derived(iconClass ?? 'h-4 w-4')
  let mobileIconClass = $derived(iconClass ?? 'h-5 w-5')

  // For Single Render optimization
  let responsiveIconClass = $derived(iconClass ? iconClass : 'h-5 w-5 sm:h-4 sm:w-4')
</script>

{#snippet ButtonContent(isMobile: boolean)}
  {#if Icon}
    <Icon class={isMobile ? mobileIconClass : defaultIconClass} />
  {/if}

  {#if isMobile}
    {#if mobileLabel}<span data-button-label>{mobileLabel}</span>{/if}
  {:else}
    {#if label}<span data-button-label class="-translate-y-px">{label}</span>{/if}
    {#if children && !label}{@render children()}{/if}
    {#if EndIcon}<EndIcon class="h-3 w-3 opacity-50" />{/if}
  {/if}
{/snippet}

{#snippet Element(targetVariant: ButtonVariant, extraClass: string, isMobile: boolean)}
  {@const finalClass = cn(
    buttonVariants({ variant: targetVariant, size }),
    extraClass,
    effectiveClass,
  )}
  {@const finalTitle = title ?? label}

  {#if href}
    <a bind:this={ref} class={finalClass} {href} title={finalTitle} {...restProps}>
      {@render ButtonContent(isMobile)}
    </a>
  {:else}
    <button bind:this={ref} class={finalClass} {type} title={finalTitle} {...restProps}>
      {@render ButtonContent(isMobile)}
    </button>
  {/if}
{/snippet}

{#if needsDualRender}
  <!-- Dual Render for Different Variants -->
  {@render Element(finalMobileVariant, 'sm:hidden', true)}
  {@render Element(variant, 'hidden sm:inline-flex', false)}
{:else if isResponsive}
  <!-- Single Render with Responsive CSS (Optimization) -->
  {@const finalTitle = title ?? label}
  {@const finalClass = cn(buttonVariants({ variant, size }), effectiveClass)}

  {#if href}
    <a bind:this={ref} class={finalClass} {href} title={finalTitle} {...restProps}>
      {#if Icon}<Icon class={responsiveIconClass} />{/if}
      {#if mobileLabel}<span data-button-label class="inline sm:hidden">{mobileLabel}</span>{/if}
      {#if label}<span data-button-label class="hidden -translate-y-px sm:inline">{label}</span
        >{/if}
      {#if children && !label}<span class="hidden sm:inline">{@render children()}</span>{/if}
      {#if EndIcon}<EndIcon class="hidden h-3 w-3 opacity-50 sm:inline" />{/if}
    </a>
  {:else}
    <button bind:this={ref} class={finalClass} {type} title={finalTitle} {...restProps}>
      {#if Icon}<Icon class={responsiveIconClass} />{/if}
      {#if mobileLabel}<span data-button-label class="inline sm:hidden">{mobileLabel}</span>{/if}
      {#if label}<span data-button-label class="hidden -translate-y-px sm:inline">{label}</span
        >{/if}
      {#if children && !label}<span class="hidden sm:inline">{@render children()}</span>{/if}
      {#if EndIcon}<EndIcon class="hidden h-3 w-3 opacity-50 sm:inline" />{/if}
    </button>
  {/if}
{:else}
  <!-- Standard Button (Non-Responsive) -->
  {#if href}
    <a
      bind:this={ref}
      class={cn(buttonVariants({ variant, size }), className)}
      {href}
      {...restProps}
    >
      {@render children?.()}
    </a>
  {:else}
    <button
      bind:this={ref}
      class={cn(buttonVariants({ variant, size }), className)}
      {type}
      {...restProps}
    >
      {@render children?.()}
    </button>
  {/if}
{/if}
