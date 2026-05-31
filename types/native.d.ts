export type NativeApi = {
  readonly platform: NodeJS.Platform
  ping(): Promise<string>
  revealDbFile(): Promise<void>
}

declare global {
  interface Window {
    native?: NativeApi
  }
}

export {}
