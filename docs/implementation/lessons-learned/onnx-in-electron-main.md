# Running ONNX inside Electron main: two traps

Desktop runs `@huggingface/transformers` (which wraps
`onnxruntime-node`) in the Electron **main** process. Both traps
below are invisible in a plain Node run of the identical code, so
"it works under `ELECTRON_RUN_AS_NODE`" proves nothing about the
real app.

## Trap 1: the CPU memory arena crashes the process

ORT's BFC arena extends by doubling into single very large
allocations. One of those requests trips Chromium's allocator
`CHECK` in the main process and the process dies with a bare
`int3` — **SIGTRAP, no JS error, no stack, no crash dump**. It only
shows up on larger models (a ~300 MB model reproduced it every
time; a 24 MB one never did) and only under Electron, because plain
Node serves the same request from glibc `malloc` happily.

```ts
pipeline('feature-extraction', modelDir, {
  session_options: { enableCpuMemArena: false },
})
```

Arena-off is an allocation strategy change only: verify by
comparing output vectors against a plain-Node reference run — ours
were bit-identical.

**Debugging note.** A silent SIGTRAP leaves nothing in the app
logs. `journalctl -k | grep traps` gives the trap address and,
crucially, which binary it landed in. Ours pointed at the
`electron` binary rather than `libonnxruntime`, which is what
identified the allocator (not ORT itself) as the killer.

## Trap 2: config-driven external-data fetch never settles

transformers.js reads `transformers.js_config.use_external_data_format`
from the model's `config.json` and then demands a sidecar named
after the model file **you** selected — `model.onnx` implies
`model.onnx_data` — not the basename the ONNX graph actually
references. When that file is absent, the missing-file path runs
inside an `async` Promise executor that never rejects: the call
hangs forever and the rejection surfaces only as an unhandled
warning.

**Symptom.** A "Test embedder" style action spins indefinitely
instead of failing into your typed-error surface.

```ts
pipeline('feature-extraction', modelDir, {
  use_external_data_format: false,
})
```

In Node the fetched sidecar is discarded anyway: ORT loads the
model by path and resolves the graph-referenced `*_data` file
itself. That is also why the sidecar must be stored under the
basename the graph references, not renamed to match the model file.

## How to apply

When a native ML runtime runs inside Electron main, budget for
allocator and packaging behaviour that no unit test reaches. Run
the real app (not `ELECTRON_RUN_AS_NODE`) against your largest
catalog entry before calling the integration done, and treat an
indefinite spinner in a lazily-initialised path as a
never-settling promise until proven otherwise.
