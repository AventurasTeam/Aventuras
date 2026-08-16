// SPDX-License-Identifier: MIT
//! A real multi-statement transaction for the frontend.
//!
//! `tauri-plugin-sql` runs every `execute()` on an arbitrary connection from its pool and
//! exposes no way to pin one, so a `BEGIN` issued from JS is never joined by the statements
//! that follow it and its `COMMIT` reaches a connection with nothing to commit — while the
//! connection that opened it keeps a write lock. This command takes the whole batch at once
//! and runs it on a single connection, which is the only place atomicity can come from.

use serde::Deserialize;
use sqlx::{AssertSqlSafe, SqlitePool};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::db::{open_rw_pool, INTERACTIVE_BUSY_TIMEOUT};

/// One batch at a time, whoever asks.
///
/// Each call opens its own connection, so two of them otherwise race for the file's write
/// lock and the loser spends `INTERACTIVE_BUSY_TIMEOUT` before failing — work rolled back
/// over a conflict that queueing avoids entirely. A rename issued right after a delete is
/// enough to hit it. Waiting here costs the same time without the error.
static TX_LOCK: Mutex<()> = Mutex::const_new(());

/// One statement and its bound parameters.
///
/// Values arrive as JSON. Only the shapes SQLite takes from this app are bound: strings,
/// numbers, booleans and null. A nested array or object is a caller mistake, not something
/// to silently stringify.
#[derive(Deserialize)]
pub struct TxStatement {
    sql: String,
    #[serde(default)]
    params: Vec<serde_json::Value>,
}

/// Run every statement in one transaction, in order. Rolls back on the first error.
///
/// Returns the number of rows each statement affected, so a caller can tell an update that
/// matched nothing from one that did.
#[tauri::command]
pub async fn db_transaction(
    app: AppHandle,
    statements: Vec<TxStatement>,
) -> Result<Vec<u64>, String> {
    if statements.is_empty() {
        return Ok(Vec::new());
    }

    let _queued = TX_LOCK.lock().await;

    let pool = open_rw_pool(&app, INTERACTIVE_BUSY_TIMEOUT).await?;
    let result = run_statements(&pool, &statements).await;
    pool.close().await;
    result
}

/// The batch itself, split out so the pool is closed on every path.
async fn run_statements(pool: &SqlitePool, statements: &[TxStatement]) -> Result<Vec<u64>, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("failed to begin transaction: {e}"))?;

    let mut affected = Vec::with_capacity(statements.len());

    for statement in statements {
        // The SQL is written in the app's own data layer and every value travels as a
        // bound parameter below — never interpolated. `AssertSqlSafe` is required because
        // the string is not a literal here; it grants this command no reach that
        // `tauri-plugin-sql`, which already executes arbitrary SQL from the same frontend,
        // does not already have.
        let mut query = sqlx::query(AssertSqlSafe(statement.sql.as_str()));

        for param in &statement.params {
            query = match param {
                serde_json::Value::Null => query.bind(None::<String>),
                serde_json::Value::Bool(b) => query.bind(*b),
                serde_json::Value::String(s) => query.bind(s.clone()),
                // `as_u64` before `as_f64`, and rejected: SQLite's INTEGER is signed 64-bit,
                // so a value past `i64::MAX` has no exact representation to bind. Falling
                // through to `as_f64` — which succeeds for every `u64` — would round it and
                // store the wrong id.
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        query.bind(i)
                    } else if n.is_u64() {
                        return Err(format!("integer parameter too large for SQLite: {n}"));
                    } else if let Some(f) = n.as_f64() {
                        query.bind(f)
                    } else {
                        return Err(format!("unsupported numeric parameter: {n}"));
                    }
                }
                other => {
                    return Err(format!(
                        "unsupported parameter type in transaction: {other}"
                    ))
                }
            };
        }

        match query.execute(&mut *tx).await {
            Ok(result) => affected.push(result.rows_affected()),
            Err(e) => {
                // Explicit rather than by drop, so a rollback that itself fails is reported
                // instead of disappearing.
                if let Err(rollback) = tx.rollback().await {
                    return Err(format!("statement failed ({e}); rollback also failed: {rollback}"));
                }
                return Err(format!("statement failed, transaction rolled back: {e}"));
            }
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    Ok(affected)
}
