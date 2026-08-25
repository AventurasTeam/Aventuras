// css-interop's wrap-jsx skips component registration when NODE_ENV === 'test',
// leaving every className in a story inert. Import the registration module
// directly to beat that guard — never hand-roll a local component list.
import 'react-native-css-interop/dist/runtime/components'
