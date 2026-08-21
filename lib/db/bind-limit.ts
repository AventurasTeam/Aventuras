// Both shipped runtimes cap binds at 32766: node:sqlite probed, expo-sqlite 55
// vendors the same SQLITE_MAX_VARIABLE_NUMBER default; 999 is a pre-3.32 floor.
// 8192 folds any realistic id set into one statement, ~24.5k spare; 4 would overrun.
export const BIND_CHUNK = 8192
