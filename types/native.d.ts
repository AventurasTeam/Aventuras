// types/native.d.ts — renderer + global Window augmentation.
// (Electron preload gets its own copy in electron/native/types.ts — the two
// compile units are separate tsconfigs, so the small duplication is intentional.)
export type NativeApi = {
  readonly platform: NodeJS.Platform
  revealDbFile(): Promise<void>
  /** Arm/disarm the window-close prompt. Disarmed windows close untouched. */
  setCloseGuard(active: boolean): void
  confirmClose(): void
  onCloseRequested(cb: () => void): () => void
  /** Lets the reload that `onReloadRequested` held go through. */
  confirmReload(): void
  onReloadRequested(cb: () => void): () => void
}

declare global {
  interface Window {
    native?: NativeApi
  }
}

export {}
