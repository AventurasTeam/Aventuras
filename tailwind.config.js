/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './.storybook/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'var(--bg-base)',
          raised: 'var(--bg-raised)',
          sunken: 'var(--bg-sunken)',
          overlay: 'var(--bg-overlay)',
          disabled: 'var(--bg-disabled)',
        },
        fg: {
          primary: 'var(--fg-primary)',
          secondary: 'var(--fg-secondary)',
          muted: 'var(--fg-muted)',
          disabled: 'var(--fg-disabled)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          fg: 'var(--accent-fg)',
        },
        success: {
          DEFAULT: 'var(--success)',
          fg: 'var(--success-fg)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          fg: 'var(--warning-fg)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          fg: 'var(--danger-fg)',
        },
        info: {
          DEFAULT: 'var(--info)',
          fg: 'var(--info-fg)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        'focus-ring': 'var(--focus-ring)',
        'selection-bg': 'var(--selection-bg)',
        'recently-classified-bg': 'var(--recently-classified-bg)',
        // State-layer tints (hover / press). Resolved at runtime
        // via color-mix on --fg-primary. See global.css for
        // rationale — sidesteps the Tailwind alpha-modifier limit
        // on var()-based colors.
        tint: {
          hover: 'var(--tint-hover)',
          press: 'var(--tint-press)',
        },
      },
      fontFamily: {
        reading: 'var(--font-reading)',
        ui: 'var(--font-ui)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        standard: 'var(--easing-standard)',
        emphasis: 'var(--easing-emphasis)',
      },
      // Density-aware sizing tokens. Heights for fixed-height
      // controls (Trigger, Button, Input); padding for rows. Each
      // resolves to a CSS var swapped by [data-density="X"] on web
      // and by NativeWind vars() on native. See
      // docs/ui/foundations/spacing.md → Density toggle.
      height: {
        'control-xs': 'var(--control-h-xs)',
        'control-sm': 'var(--control-h-sm)',
        'control-md': 'var(--control-h-md)',
        'control-lg': 'var(--control-h-lg)',
      },
      // Mirror as widths for square (icon-button-shaped) controls.
      width: {
        'control-xs': 'var(--control-h-xs)',
        'control-sm': 'var(--control-h-sm)',
        'control-md': 'var(--control-h-md)',
        'control-lg': 'var(--control-h-lg)',
      },
      padding: {
        'row-y-xs': 'var(--row-py-xs)',
        'row-y-sm': 'var(--row-py-sm)',
        'row-y-md': 'var(--row-py-md)',
        'row-y-lg': 'var(--row-py-lg)',
        'row-x-xs': 'var(--row-px-xs)',
        'row-x-sm': 'var(--row-px-sm)',
        'row-x-md': 'var(--row-px-md)',
        'row-x-lg': 'var(--row-px-lg)',
      },
      // Web-only entry animations for overlay primitives. Native
      // gets these via reanimated layout-animations
      // (FadeIn/SlideInDown/SlideInRight) on Sheet + Popover; web
      // would otherwise snap-in instantly because
      // NativeOnlyAnimatedView is a no-op on web. Keyframes target
      // radix-ui's `data-state="open"` attribute via Tailwind's
      // `data-[state=open]:animate-*` arbitrary variant.
      // Durations match the reanimated values
      // (Sheet: 250ms, Popover/overlay: 200ms).
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-in-from-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-from-top': {
          from: { transform: 'translateY(-100%)' },
          to: { transform: 'translateY(0)' },
        },
        // Radix exposes the measured Accordion content height via
        // --radix-accordion-content-height. Native side animates
        // via reanimated LinearTransition; web reads the var here.
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms var(--easing-standard)',
        'slide-in-from-bottom': 'slide-in-from-bottom 250ms var(--easing-standard)',
        'slide-in-from-right': 'slide-in-from-right 250ms var(--easing-standard)',
        'slide-in-from-top': 'slide-in-from-top 250ms var(--easing-standard)',
        'accordion-down': 'accordion-down 200ms var(--easing-standard)',
        'accordion-up': 'accordion-up 200ms var(--easing-standard)',
      },
    },
  },
  plugins: [],
}
