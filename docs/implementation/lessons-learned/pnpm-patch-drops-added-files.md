# `pnpm patch-commit` silently drops files you added

`pnpm patch` gives you a scratch copy of a package to edit, and
`pnpm patch-commit` diffs it back into `patches/<pkg>.patch`. Edits
to **existing** files land correctly. Files you **create** in the
scratch directory are dropped, with no warning and a successful
exit.

**Symptom.** The patch applies cleanly on install, the edited files
are correct, and the file you added is simply absent from
`node_modules`. Because everything else worked, the natural
conclusion is that the added file was never needed.

## The fix

Verify the patch's file list before trusting it:

```sh
grep 'diff --git' patches/onnxruntime-react-native.patch
```

If an intended path is missing, hand-append a new-file hunk and
re-run `pnpm install`:

```diff
diff --git a/react-native.config.js b/react-native.config.js
new file mode 100644
--- /dev/null
+++ b/react-native.config.js
@@ -0,0 +1,3 @@
+module.exports = {
+  /* … */
+}
```

Note this in a comment near the patch entry: a later regeneration
of the patch will drop the hunk again.

## Worked example

`onnxruntime-react-native` needs two fixes: a Gradle-9 edit to
`android/build.gradle` (existing file, diffed fine) and a
`react-native.config.js` that does not exist upstream. Without the
config, RN autolinking never registers `OnnxruntimePackage` and the
native module is `null` at runtime. The added file was dropped by
`patch-commit` twice before the omission was noticed, and the
Gradle half applying cleanly each time made it look like the patch
had fully landed.

## How to apply

Any pnpm patch that **adds** a file needs an explicit verification
step, and any later regeneration of that patch needs the added
hunks re-appended. Prefer patches that only modify existing files
where a choice exists.

Related: [Native-module RN libs need a dev-client rebuild](./native-dep-expo-link.md)
for the rest of the native-dep install ritual.
