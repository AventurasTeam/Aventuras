//! An in-memory database migrated as the plugin migrates the app's, for migration tests.

use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

pub async fn memory_pool() -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap()
}

/// Runs the migrations after `after`, up to and including `through`.
pub async fn run_migrations(pool: &SqlitePool, after: i64, through: i64) {
    for migration in crate::migrations() {
        if migration.version <= after || migration.version > through {
            continue;
        }
        sqlx::raw_sql(migration.sql)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("migration {} failed: {e}", migration.version));
    }
}
