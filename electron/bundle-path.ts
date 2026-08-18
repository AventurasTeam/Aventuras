import { statSync } from 'node:fs'
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

  // `isFile`, not an existence check: `/_expo` hits the asset directory, which
  // `net.fetch` cannot read and would surface as a 500 instead of the shell.
  // The catch also covers ENOTDIR (`/index.html/x`) and EACCES — this runs
  // outside the protocol handler's own try, so a throw blanks the window.
  try {
    return statSync(resolved).isFile() ? resolved : indexHtml
  } catch {
    return indexHtml
  }
}
