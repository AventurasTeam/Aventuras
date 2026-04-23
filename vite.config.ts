import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
});
