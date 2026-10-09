/** The `ComfyApi` members the fetch patch in `comfy.ts` replaces or calls. They are not in the SDK's
 *  public types, so a test (`comfy.test.ts`) asserts they still exist on the prototype after an upgrade. */
export const COMFY_API_FETCH_MEMBERS = ['fetchApi', 'apiURL', 'getCredentialHeaders'] as const

export type ComfyApiFetchInternals = {
  fetchApi: (path: string, options?: RequestInit) => Promise<Response>
  apiURL: (path: string) => string
  getCredentialHeaders: () => Record<string, string>
}
