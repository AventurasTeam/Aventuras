type GateThunks = { isEnabled: () => boolean; isDebugEnabled: () => boolean }

const OFF: GateThunks = { isEnabled: () => false, isDebugEnabled: () => false }

let gate: GateThunks = OFF

// Injected, never imported: the composition root passes thunks that read
// app_settings.diagnostics live (lib/diagnostics must not import lib/stores —
// it is zero-dependency infra everything else logs through). The thunks must
// be live getters; capturing a snapshot freezes the gate at boot.
export function configureDiagnosticsGate(thunks: GateThunks): void {
  gate = thunks
}

export function isDiagnosticsEnabled(): boolean {
  return gate.isEnabled()
}

export function isDiagnosticsDebugEnabled(): boolean {
  return gate.isDebugEnabled()
}

export function __resetDiagnosticsGate(): void {
  gate = OFF
}
