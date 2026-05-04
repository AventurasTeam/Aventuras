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
    },
  },
  plugins: [],
}
