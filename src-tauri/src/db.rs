// SPDX-License-Identifier: MIT
//! Access to the live application database from the native side.

use std::path::PathBuf;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

/// Path to the live application database (app_config_dir/aventura.db).
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?
        .join("aventura.db"))
}

/// How long a caller waits for the write lock before it reports SQLITE_BUSY.
///
/// The sql plugin holds its own connection to the same file and WAL allows one writer at a time,
/// so this is what keeps a concurrent app write from failing outright. It is the caller's to
/// choose because the two ends of the range are different jobs: a background import can afford
/// to wait, and a wait nobody asked for is time the user spends in front of a frozen control.
pub const IMPORT_BUSY_TIMEOUT: Duration = Duration::from_secs(30);

/// A batch behind a control the user is looking at. Long enough to ride out a turn's writes,
/// short enough that a lock held by something wedged surfaces as an error instead of a freeze.
pub const INTERACTIVE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Open a writable single-connection pool to the live database.
///
/// Close the pool when done: dropping it leaves the connection to be reaped asynchronously,
/// still holding whatever the last statement took.
pub async fn open_rw_pool(app: &AppHandle, busy_timeout: Duration) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::new()
        .filename(db_path(app)?)
        .create_if_missing(false)
        .busy_timeout(busy_timeout);

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("failed to open database: {e}"))
}
