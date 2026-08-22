// types/native.d.ts — renderer + global Window augmentation.
// (Electron preload gets its own copy in electron/native/types.ts — the two
// compile units are separate tsconfigs, so the small duplication is intentional.
// native-bridge-sync.test.ts fails if the two declarations drift apart.)
export type NativeApi = {
  readonly platform: NodeJS.Platform
  revealDbFile(): Promise<void>
  /** Arm/disarm the window-close prompt. Disarmed windows close untouched. */
  setCloseGuard(active: boolean): void
  confirmClose(): void
  onCloseRequested(cb: () => void): () => void
  /** Re-issues the reload `onReloadRequested` refused — the original was cancelled, not parked. */
  confirmReload(): void
  onReloadRequested(cb: () => void): () => void
}

declare global {
  interface Window {
    native?: NativeApi
  }
}

export {}
