export type NativeApi = {
  readonly platform: NodeJS.Platform
  ping(): Promise<string>
}

declare global {
  interface Window {
    native?: NativeApi
  }
}

export {}
