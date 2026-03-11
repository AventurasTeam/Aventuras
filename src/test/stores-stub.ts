// Prevents settings.svelte.ts from loading — avoids Svelte rune transform requirement
export const settings = {
  getPresetConfig: () => ({}),
  serviceSpecificSettings: null,
}
export const story = {}
export const storyUI = {}
