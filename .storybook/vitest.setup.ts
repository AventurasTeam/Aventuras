// react-native-css-interop's wrap-jsx guards its own component registration
// with `if (process.env.NODE_ENV !== 'test')`, so under vitest nothing is
// registered and every className in a story is inert. Importing the
// registration module directly beats that guard while still using the
// library's canonical component list rather than a local copy that can drift.
import 'react-native-css-interop/dist/runtime/components'
