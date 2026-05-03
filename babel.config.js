module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // react-native-worklets/plugin (reanimated 4.x's worklet runtime)
    // auto-detects worklet boundaries and adds the dependency array
    // for hooks like useAnimatedStyle. Without it, every callsite
    // emits "useAnimatedStyle was used without a dependency array
    // or Babel plugin." MUST be last in the plugins list.
    plugins: ['react-native-worklets/plugin'],
  }
}
