<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { X, AlertTriangle, Info, AlertCircle } from '@lucide/svelte'

  function getIcon() {
    switch (ui.toastType) {
      case 'error':
        return AlertCircle
      case 'warning':
        return AlertTriangle
      case 'info':
      default:
        return Info
    }
  }

  function getBackgroundColor() {
    switch (ui.toastType) {
      case 'error':
        return 'bg-red-600'
      case 'warning':
        return 'bg-amber-600'
      case 'info':
      default:
        return 'bg-blue-600'
    }
  }

  function handleClick() {
    ui.hideToast()
  }

  const Icon = $derived(getIcon())
</script>

{#if ui.toastVisible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed top-16 left-1/2 z-[9999] flex -translate-x-1/2 items-start gap-3 rounded-lg px-4 py-3 shadow-2xl {getBackgroundColor()} animate-fade-in animate-slide-in w-[calc(100vw-2rem)] max-w-2xl cursor-pointer sm:top-4 sm:right-4 sm:left-auto sm:max-w-lg sm:translate-x-0 sm:cursor-default sm:rounded-xl sm:px-5 sm:py-4"
    role="alert"
    onmouseenter={() => ui.setToastHovering(true)}
    onmouseleave={() => ui.setToastHovering(false)}
    onclick={handleClick}
  >
    <Icon class="mt-0.5 h-5 w-5 shrink-0 text-white sm:h-6 sm:w-6" />
    <span class="flex-1 text-sm leading-snug font-medium text-white sm:text-base"
      >{ui.toastMessage}</span
    >
    <button
      class="ml-2 hidden shrink-0 text-white/70 transition-colors hover:text-white sm:flex"
      onclick={(e) => {
        e.stopPropagation()
        handleClick()
      }}
      aria-label="Close notification"
    >
      <X class="h-4 w-4 sm:h-5 sm:w-5" />
    </button>
  </div>
{/if}

<style>
  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slide-in-mobile {
    from {
      transform: translateY(-1rem);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes slide-in-desktop {
    from {
      transform: translateX(1rem);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .animate-fade-in {
    animation: fade-in 0.3s ease-out;
  }

  .animate-slide-in {
    animation: slide-in-mobile 0.3s ease-out;
  }

  @media (min-width: 640px) {
    .animate-slide-in {
      animation: slide-in-desktop 0.3s ease-out;
    }
  }
</style>
