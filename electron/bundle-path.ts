import { existsSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'

/**
 * Maps an `app://` URL path onto a file inside the exported web bundle,
 * falling back to the SPA shell for anything that isn't a real file.
 *
 * `app.json` sets web `output` to `single`, so `dist/` holds one
 * `index.html` and no per-route directories — every deep route misses on
 * disk and has to reach the shell for client-side routing to take over.
 * Extension sniffing can't make that call, since a route param may carry
 * a dot; only an existence check separates an asset from a route.
 */
export function resolveBundlePath(urlPath: string, distRoot: string): string {
  const indexHtml = join(distRoot, 'index.html')

  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath) || '/'
  } catch {
    return indexHtml
  }

  const resolved = normalize(join(distRoot, decoded === '/' ? '/index.html' : decoded))

  // Prefix-compare against `distRoot + sep`, not `distRoot` — a bare prefix
  // test also admits sibling dirs sharing the name (`dist-evil/`).
  if (resolved !== distRoot && !resolved.startsWith(distRoot + sep)) return indexHtml

  return existsSync(resolved) ? resolved : indexHtml
}
