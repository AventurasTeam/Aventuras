module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      // @huggingface/transformers' web dist (bundled on native too — see
      // metro-native-ignores-browser-builds.md) uses `import.meta`, which Hermes
      // can't parse without this polyfill transform.
      ['babel-preset-expo', { jsxImportSource: 'nativewind', unstable_transformImportMeta: true }],
      'nativewind/babel',
    ],
    plugins: [
      // Bundles drizzle's generated .sql into migrations.js for the expo migrator.
      ['inline-import', { extensions: ['.sql'] }],
      // react-native-worklets/plugin auto-detects worklet boundaries. MUST be last.
      'react-native-worklets/plugin',
    ],
  }
}
