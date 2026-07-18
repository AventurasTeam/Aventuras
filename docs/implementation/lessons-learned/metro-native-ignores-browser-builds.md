# Metro's native resolution ignores browser-targeted builds

Packages that ship a Node build plus a browser-safe build select
between them via the `browser` main field or a `browser` exports
condition. Web bundling honors both — which is why a dependency can
work perfectly on web and still break every Android bundle. Metro's
**native** resolution honors neither:

- **`browser` main field** (no exports map): native resolves `main`.
  Observed with `juice` — `import juice from 'juice'` bundles
  `index.js` (needs `fs` via web-resource-inliner) on Android even
  though `client.js` is declared as the browser entry.
- **`browser` exports condition** (exports map present, and
  `unstable_enablePackageExports` is on in this repo): native applies
  only the `import` / `require` / `react-native` conditions. Observed
  with `cheerio` — native resolves `dist/esm/index.js` (needs
  `node:stream`) even though a Node-free `dist/browser/` build exists.

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
3. **Browser exports condition ignored** → pin the module to its
   browser build with a platform-gated `resolveRequest` in
   `metro.config.js` (see the cheerio redirect there). Use
   `path.join`, not `require.resolve` — Node's resolver enforces the
   exports map and rejects non-exported dist paths.
4. Prefer these two targeted levers over adding `browser` to
   `unstable_conditionNames` globally — that flips resolution for
   every package at once and can swap in DOM-flavored builds where
   the Node/RN flavor was correct.
