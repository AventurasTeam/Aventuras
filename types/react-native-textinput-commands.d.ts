// RN ships these command modules untyped (Flow source, no .d.ts). Minimal
// declarations for the setTextAndSelection path used by
// components/ui/controlled-text-sync.native.ts.
type RNTextInputNativeCommands = {
  focus(viewRef: unknown): void
  blur(viewRef: unknown): void
  setTextAndSelection(
    viewRef: unknown,
    mostRecentEventCount: number,
    value: string | null,
    start: number,
    end: number,
  ): void
}

declare module 'react-native/Libraries/Components/TextInput/AndroidTextInputNativeComponent' {
  export const Commands: RNTextInputNativeCommands
}

declare module 'react-native/Libraries/Components/TextInput/RCTMultilineTextInputNativeComponent' {
  export const Commands: RNTextInputNativeCommands
}

// "Singeline" is RN's own filename typo; the import must match it.
declare module 'react-native/Libraries/Components/TextInput/RCTSingelineTextInputNativeComponent' {
  export const Commands: RNTextInputNativeCommands
}
