import { onMount } from 'svelte'

/**
 * Layout breakpoint hook for components that need a tighter "compact" threshold
 * than the 768px `createIsMobile` gives. Fires true below 1024px (Tailwind lg).
 */
export function createIsCompact() {
  let isCompact = $state(false)

  onMount(() => {
    const mql = window.matchMedia('(max-width: 1023px)')

    const onChange = () => {
      isCompact = mql.matches
    }

    mql.addEventListener('change', onChange)
    isCompact = mql.matches

    return () => mql.removeEventListener('change', onChange)
  })

  return {
    get current() {
      return isCompact
    },
  }
}
