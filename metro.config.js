const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

config.resolver.sourceExts.push('sql')
config.resolver.unstable_enablePackageExports = true

module.exports = withNativeWind(config, { input: './global.css' })
