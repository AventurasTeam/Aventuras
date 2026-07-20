const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

config.resolver.sourceExts.push('sql')
config.resolver.unstable_enablePackageExports = true

// @huggingface/transformers resolves to its web dist on native (Metro ignores the
// `node` exports condition), which statically imports onnxruntime-web — a WASM/DOM
// backend that breaks the Android bundle. We only use the tokenizer; inference runs
// through onnxruntime-react-native directly. Redirect the bare specifier on native
// so ORT-web never enters the bundle. See docs/implementation/lessons-learned/
// metro-native-ignores-browser-builds.md.
const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web' && moduleName === 'onnxruntime-web') {
    return context.resolveRequest(context, 'onnxruntime-react-native', platform)
  }
  const next = defaultResolveRequest ?? context.resolveRequest
  return next(context, moduleName, platform)
}

module.exports = withNativeWind(config, { input: './global.css' })
