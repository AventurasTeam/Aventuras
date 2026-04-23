import type { Preview } from '@storybook/react-native-web-vite';

import '../global.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' = surface a11y violations in the test panel only
      // 'error' = fail CI on violations
      // 'off'   = disable
      test: 'todo',
    },
    backgrounds: {
      options: {
        light: { name: 'Light', value: 'hsl(0 0% 100%)' },
        dark: { name: 'Dark', value: 'hsl(0 0% 3.9%)' },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'light' },
  },
  globalTypes: {
    theme: {
      description: 'Theme (toggles the .dark class on <html>)',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme ?? 'light';
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', theme === 'dark');
      }
      return Story();
    },
  ],
};

export default preview;
