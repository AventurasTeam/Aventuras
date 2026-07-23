export type NativeApi = {
  readonly platform: NodeJS.Platform
  revealDbFile(): Promise<void>
  /** Arm/disarm the window-close prompt. Disarmed windows close untouched. */
  setCloseGuard(active: boolean): void
  confirmClose(): void
  onCloseRequested(cb: () => void): () => void
}
