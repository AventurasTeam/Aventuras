// Storybook's Vite dev/build always runs in a real browser, so
// `lib/markdown/sanitize.ts`'s `typeof window !== 'undefined'` branch is
// always taken there and the real `jsdom` package is never constructed —
// that branch only exists for Metro's browser bundle and Expo Router's
// Node-based static prerender (see commit abd5877a).
//
// Vite's dependency pre-bundler doesn't know that at scan time: it
// statically hoists the guarded `require('jsdom')` and evaluates jsdom's
// module-scope code unconditionally, which touches `SharedArrayBuffer` —
// unavailable in a non-cross-origin-isolated browser tab — and crashes
// every story in the file before any component renders.
//
// `.storybook/main.ts` aliases the bare `jsdom` specifier to this stub so
// Vite never pulls in the real package. The constructor throws so any
// future code path that actually tries to instantiate `JSDOM` inside
// Storybook fails loudly instead of silently misbehaving.
export class JSDOM {
  constructor() {
    throw new Error(
      'jsdom stub: should never be constructed in Storybook (window always exists there)',
    )
  }
}

// Real `jsdom` is CJS (`module.exports = { JSDOM, ... }`); mirroring that
// shape as the default export avoids a build-time "default will always be
// undefined" warning from bundlers whose CJS-interop probes `.default`
// before falling back to named exports.
export default { JSDOM }
