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
      padding: {
        row: 'var(--row-pad-y) var(--row-pad-x)',
        input: 'var(--input-pad-y) var(--input-pad-x)',
        button: 'var(--button-pad-y) var(--button-pad-x)',
      },
    },
  },
  plugins: [],
}
