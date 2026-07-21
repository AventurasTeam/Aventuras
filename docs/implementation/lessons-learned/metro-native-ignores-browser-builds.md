# Metro's native resolution ignores browser-targeted builds

Packages that ship a Node build plus a browser-safe build select
between them via the `browser` main field or a `browser` exports
condition. Web bundling honors both — which is why a dependency can
work perfectly on web and still break every Android bundle. Metro's
**native** resolution honors neither, and a package that offers no
browser branch at all fails the same way. Four distinct shapes:

- **`browser` main field** (no exports map): native resolves `main`.
  Observed with `juice` — `import juice from 'juice'` bundles
  `index.js` (needs `fs` via web-resource-inliner) on Android even
  though `client.js` is declared as the browser entry.
- **`browser` exports condition** (exports map present, and
  `unstable_enablePackageExports` is on in this repo): native applies
  only the `import` / `require` / `react-native` conditions. Observed
  with `cheerio` — native resolves `dist/esm/index.js` (needs
  `node:stream`) even though a Node-free `dist/browser/` build exists.
- **No `browser` condition at all** — the exports map keys on `node`
  and everything else falls through to a web `default`. Observed with
  `@huggingface/transformers`, whose map is
  `{ node: { import, require }, default: dist/transformers.web.js }`.
  Native never satisfies `node`, so it lands on the web dist by
  fallthrough, not by anything `browser`-flavored. `metro.config.js`
  redirects one of that dist's sub-imports (`onnxruntime-web`) on
  native for exactly this reason.
- **Syntax the bundled build ships that Hermes can't parse.** Even
  once the bundled file is otherwise RN-safe, its web dist can still
  use syntax Metro's default transform doesn't polyfill. The same
  `transformers.web.js` uses `import.meta`, which crashes the Android
  bundle with a Hermes parse error distinct from the resolution
  failures above.

The failure is invisible until someone runs
`expo export --platform android`: web builds, tests, and typecheck
all pass, so a broken Android bundle can sit on main for weeks (this
is exactly how the M2 `lib/markdown` → juice → jsdom break shipped).

## How to apply

1. When adding a dependency that has any Node flavor (check its
   `package.json` for `browser`, `exports` conditions, or deps like
   `fs`/`node:*`/`undici`), verify with a real
   `expo export --platform android` — not just web + tests.
2. **Browser main field ignored** → deep-import the browser entry
   explicitly (`import juice from 'juice/client'`), with an ambient
   `.d.ts` if the subpath is untyped (see `types/juice-client.d.ts`).
3. **Wrong build resolved** (browser condition ignored, or `node`
   fallthrough) → pin the specifier with a platform-gated
   `resolveRequest` in `metro.config.js`. The `onnxruntime-web`
   redirect there is the surviving example of the lever; it swaps one
   package for another rather than pointing at a dist path, but the
   hook is the same. When you do point at a dist path, use
   `path.join`, not `require.resolve` — Node's resolver enforces the
   exports map and rejects non-exported dist paths.
4. Prefer these two targeted levers over adding `browser` to
   `unstable_conditionNames` globally — that flips resolution for
   every package at once and can swap in DOM-flavored builds where
   the Node/RN flavor was correct.
5. **Hermes parse error on bundled syntax** (e.g. `import.meta`) →
   enable the specific babel-preset-expo polyfill for that syntax
   (`unstable_transformImportMeta: true` in `babel.config.js`) rather
   than rewriting the dependency; it's the whole bundled file's
   syntax, not something a `resolveRequest` redirect can dodge.
