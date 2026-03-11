// Default export: covers import Database from '@tauri-apps/plugin-sql'
// and any other @tauri-apps package using a default export
const stub = {}
export default stub

// Named no-ops — covers all known import shapes from @tauri-apps/* in src/lib/
export const invoke = () => Promise.resolve(undefined)
export const emit = () => Promise.resolve(undefined)
export const listen = () => Promise.resolve(() => {})
export const save = () => Promise.resolve(null)
export const open = () => Promise.resolve(null)
export const writeFile = () => Promise.resolve(undefined)
export const writeTextFile = () => Promise.resolve(undefined)
export const readFile = () => Promise.resolve(new Uint8Array())
export const readTextFile = () => Promise.resolve('')
export const remove = () => Promise.resolve(undefined)
export const exists = () => Promise.resolve(false)
export const mkdir = () => Promise.resolve(undefined)
export const fetch = () => Promise.resolve(new Response())
export const relaunch = () => Promise.resolve(undefined)
export const check = () => Promise.resolve(null)
export const getVersion = () => Promise.resolve('0.0.0')
export const WebviewWindow = class {}
export const path = {}
