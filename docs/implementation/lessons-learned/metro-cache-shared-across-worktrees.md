# A worktree with symlinked `node_modules` needs its own Metro cache

A suspected cause from one report, not reproduced. An E2E run in a
scratch worktree whose `node_modules` was a symlink to the main
checkout's built a web bundle in which expo-router found no routes, so
every test timed out at 30 s on "No routes found". Pointing Metro at a
per-worktree cache directory, through a scratch-only `cacheStores`
override, made the run pass.

## Why (suspected)

Read from the installed packages (`@expo/metro-config` 55.0.17,
`metro` 0.83.6, `babel-preset-expo` 55.0.18), not observed at runtime:

- **One cache for every checkout.** Expo's default config stores
  transforms in a `FileStore` at `os.tmpdir()/metro-cache`, normally
  `/tmp/metro-cache` (`@expo/metro-config/build/ExpoMetroConfig.js`,
  around line 192). Every checkout on the machine shares it.
- **No project root in the key.** Metro keys a transform on the
  file's path relative to `projectRoot`, the transform options and a
  SHA-1 of the file's content (`metro/src/DeltaBundler/Transformer.js`,
  around lines 73 to 108). The base hash from `getTransformCacheKey.js`
  adds the transformer's code and config, and Expo keeps absolute
  paths out of that config on purpose. Two checkouts at different
  paths compute the same key for the same file.
- **The output does hold a path.** The expo-router Babel plugin
  replaces `EXPO_ROUTER_APP_ROOT` with the path from the file being
  transformed to the app's `app/` directory
  (`babel-preset-expo/build/expo-router-plugin.js`). That string is
  baked into the cached transform of expo-router's `_ctx` files.

With `nodeLinker: hoisted` and a checkout's own `node_modules`, the
`_ctx` files sit at `node_modules/expo-router/` in every checkout: the
same key and the same baked `../../app`, which is right in each, so
sharing is harmless. In a worktree whose `node_modules` is a symlink,
Metro may name the file by its real path under the main checkout. Its
project-relative path is then the climb back to the main checkout's
`node_modules`, identical for worktrees that sit alike relative to it
(any two under `.claude/worktrees/`, say), while the baked path points
into whichever worktree transformed it first. A later worktree gets a
cache hit whose `require.context` reads an
`app/` that went away with its worktree: an empty route tree, a clean
build, and "No routes found" at runtime.

The unverified link is the real path. If Metro keys the file by its
path through the symlink instead, both strings match a normal
checkout's and nothing collides, so the cause lies elsewhere.

## How to apply

- **Before `pnpm build:web` in a scratch worktree with symlinked
  `node_modules`**, give Metro a cache of its own with a scratch-only
  edit to `metro.config.js`, never committed:

  ```js
  const os = require('node:os')
  const path = require('node:path')
  const { FileStore } = require('@expo/metro/metro-cache')

  config.cacheStores = [
    new FileStore({ root: path.join(os.tmpdir(), `metro-cache-${path.basename(__dirname)}`) }),
  ]
  ```

  The directory sits outside the worktree, where nothing in it can
  trip the local gates.

- **`expo export --clear` is not the fix** (reasoned, not tried): it
  empties the shared store, and the worktree's own transforms then
  refill it with its path, ready to fail the next worktree placed like
  it once this one is gone.

- **The tell** is every E2E test timing out on "No routes found" while
  the build succeeded and the worktree's `app/` is intact.

See also [dev slots](../../dev-environment.md#what-a-slot-owns), which
split a worktree's ports and `userData` but not this cache.
