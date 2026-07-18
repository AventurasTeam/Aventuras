const path = require('path')

const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

config.resolver.sourceExts.push('sql')
config.resolver.unstable_enablePackageExports = true

// Native resolution applies only the import/react-native exports conditions,
// so cheerio (via juice/client in lib/markdown/sanitize.native.ts) resolves to
// its Node ESM build and dies on node:stream. Pin cheerio to the Node-free
// browser build — the same one web bundles via the browser condition.
const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web' && moduleName === 'cheerio') {
    // path.join, not require.resolve: the dist path is outside cheerio's
    // exports map, which Node's resolver enforces.
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'node_modules/cheerio/dist/browser/index.js'),
    }
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform)
}

module.exports = withNativeWind(config, { input: './global.css' })
